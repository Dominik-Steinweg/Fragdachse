import type { TrackedProjectile } from '../types';
import type { ProjectileId } from './ProjectileSpawnPort';

/**
 * Kanonische Projectile-Registry genau einer World.
 *
 * Sie vergibt die Identity, hält die Runtime-Records in Verarbeitungsreihenfolge und ist der
 * einzige Ort, an dem ein Projectile entsteht oder verschwindet. Der Store ist kein öffentliches
 * Repository: er gehört dem `WorldProjectileRuntime`-Owner, der ihn erzeugt, füllt und mit der
 * World wieder abräumt.
 *
 * Eine `ProjectileId` wird innerhalb dieses Stores nie wiederverwendet; erst der World-Teardown
 * beendet den Identity-Scope.
 */
export class ProjectileStore {
  private nextId = 0;
  /** Verarbeitungsreihenfolge inklusive bereits zum Abbau vorgemerkter Records. */
  private readonly records: TrackedProjectile[] = [];
  private readonly active = new Set<TrackedProjectile>();
  private readonly byId = new Map<ProjectileId, TrackedProjectile>();

  /** Vergibt die nächste Identity. Einzige ID-Quelle dieser World. */
  allocateId(): ProjectileId {
    return this.nextId++;
  }

  /** Nimmt einen fertig erzeugten Record in Identity, Aktivmenge und Verarbeitung auf. */
  insert(record: TrackedProjectile): void {
    this.records.push(record);
    this.active.add(record);
    this.byId.set(record.id, record);
  }

  /** Stabile, allokationsfreie Sicht in Verarbeitungsreihenfolge. */
  get stepOrder(): readonly TrackedProjectile[] {
    return this.records;
  }

  /** Stabile, allokationsfreie Sicht auf die noch wirksamen Projectiles. */
  get activeRecords(): ReadonlySet<TrackedProjectile> {
    return this.active;
  }

  get activeCount(): number {
    return this.active.size;
  }

  getById(id: ProjectileId): TrackedProjectile | undefined {
    return this.byId.get(id);
  }

  /**
   * Nimmt einen Record aus der Aktivmenge, ohne seine Identity zu beenden.
   *
   * Ein zum Abbau vorgemerktes Projectile verlässt die Aktivmenge sofort, bleibt für den
   * verzögerten Cleanup aber auffindbar.
   */
  deactivate(record: TrackedProjectile): void {
    this.active.delete(record);
  }

  /** Beendet Identity und Aktivmenge; der Record bleibt bis zum Drop in der Verarbeitung. */
  detach(record: TrackedProjectile): void {
    this.active.delete(record);
    this.byId.delete(record.id);
  }

  /** Entfernt den Eintrag an dieser Position aus der Verarbeitungsreihenfolge. */
  dropStepEntryAt(index: number): void {
    this.records.splice(index, 1);
  }

  /** Position des Records in der Verarbeitungsreihenfolge; `-1`, wenn er dort fehlt. */
  indexOfStepEntry(record: TrackedProjectile): number {
    return this.records.indexOf(record);
  }

  /** Leert Identity, Aktivmenge und Verarbeitungsreihenfolge. */
  clear(): void {
    this.records.length = 0;
    this.active.clear();
    this.byId.clear();
  }
}

/**
 * Befristete Sicht des noch nicht migrierten Host-Simulationscodes auf **denselben** kanonischen
 * Store (`03 §5.1`).
 *
 * Sie kopiert nichts, vergibt keine Identity und erzeugt keinen zweiten Lifecycle; Spawn und
 * endgültige Entfernung bleiben beim Owner. Mit dem Cutover der jeweiligen Verarbeitung
 * (Phasen 3–14) entfällt sie.
 */
export type LegacyProjectileStoreAccess = Pick<
  ProjectileStore,
  'stepOrder' | 'activeRecords' | 'activeCount' | 'getById' | 'deactivate' | 'dropStepEntryAt'
>;
