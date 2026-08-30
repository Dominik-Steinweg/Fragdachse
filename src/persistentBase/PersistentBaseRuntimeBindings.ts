import type { PersistentConstruction } from './PersistentBaseTypes';

/** Ein materialisierter Blueprint und das Runtime-Objekt, das ihn gerade darstellt. */
export interface PersistentRuntimeBinding {
  readonly runtimeId: number;
  readonly ownerId: string;
  readonly blueprint: PersistentConstruction;
}

/**
 * Die Runtime-Objekte der persistenten Basis in genau **einer** World-Instanz.
 *
 * Sie gehoeren der World und nicht dem Raum: Ein Blueprint lebt weiter, wenn seine World endet,
 * sein Objekt nicht. Deshalb liegt diese Zuordnung beim `PersistentBaseWorldBinding` und nicht im
 * raumlanglebigen Beitragsspeicher, der sie nur liest, solange eine World steht.
 */
export class PersistentBaseRuntimeBindings {
  private readonly bindings = new Map<number, { ownerId: string; blueprint: PersistentConstruction }>();

  /** Bindet ein Runtime-Objekt an seinen Blueprint. */
  bind(runtimeId: number, ownerId: string, blueprint: PersistentConstruction): void {
    this.bindings.set(runtimeId, { ownerId, blueprint: cloneBlueprint(blueprint) });
  }

  /**
   * Bindet einen wiederhergestellten Blueprint neu.
   *
   * Eine frueher materialisierte Instanz desselben Blueprints wird dabei geloest: Derselbe Besitz
   * traegt nie zwei Objekte gleichzeitig.
   */
  rebind(runtimeId: number, ownerId: string, blueprint: PersistentConstruction): void {
    for (const [existingId, existing] of this.bindings) {
      if (existing.ownerId !== ownerId || existing.blueprint.persistentId !== blueprint.persistentId) continue;
      this.bindings.delete(existingId);
    }
    this.bind(runtimeId, ownerId, blueprint);
  }

  get(runtimeId: number): { readonly ownerId: string; readonly blueprint: PersistentConstruction } | undefined {
    return this.bindings.get(runtimeId);
  }

  findRuntimeId(ownerId: string, persistentId: string): number | undefined {
    for (const [runtimeId, entry] of this.bindings) {
      if (entry.ownerId === ownerId && entry.blueprint.persistentId === persistentId) return runtimeId;
    }
    return undefined;
  }

  /** Aktualisiert den gebundenen Blueprint, ohne die Runtime-Bindung zu wechseln. */
  updateBlueprint(ownerId: string, blueprint: PersistentConstruction): void {
    for (const [runtimeId, entry] of this.bindings) {
      if (entry.ownerId !== ownerId || entry.blueprint.persistentId !== blueprint.persistentId) continue;
      this.bindings.set(runtimeId, { ownerId, blueprint: cloneBlueprint(blueprint) });
    }
  }

  /** Loest genau eine Bindung; der Blueprint bleibt unangetastet. */
  release(runtimeId: number): boolean {
    return this.bindings.delete(runtimeId);
  }

  /** Loest alle Bindungen eines Besitzers und meldet die Objekte, die aus der Welt fallen. */
  releaseOwner(ownerId: string): readonly number[] {
    const runtimeIds: number[] = [];
    for (const [runtimeId, entry] of this.bindings) {
      if (entry.ownerId !== ownerId) continue;
      runtimeIds.push(runtimeId);
      this.bindings.delete(runtimeId);
    }
    return runtimeIds;
  }

  entries(): readonly PersistentRuntimeBinding[] {
    return [...this.bindings.entries()].map(([runtimeId, entry]) => ({
      runtimeId,
      ownerId: entry.ownerId,
      blueprint: entry.blueprint,
    }));
  }

  clear(): void {
    this.bindings.clear();
  }
}

function cloneBlueprint(blueprint: PersistentConstruction): PersistentConstruction {
  return { ...blueprint, tool: { ...blueprint.tool } };
}
