import type { ProjectileRuntimeRecord } from '../types';
import type { ProjectileIdentityScope } from './ProjectileIdentityScope';
import type { ProjectileId } from './ProjectileSpawnPort';

/**
 * Kanonische Projectile-Registry genau einer World.
 *
 * Sie vergibt die Identity, hält die Runtime-Records in Verarbeitungsreihenfolge und ist der
 * einzige Ort, an dem ein Projectile entsteht oder verschwindet. Der Store ist kein öffentliches
 * Repository: er gehört dem `WorldProjectileRuntime`-Owner, der ihn erzeugt, füllt und mit der
 * World wieder abräumt.
 *
 * Die ID-Vergabe delegiert an den worldRevision-langlebigen Identity-Scope. Ein lokaler Store-
 * Teardown leert nur die Registry; der Scope bleibt bis zum Ende der World-Instanz erhalten.
 */
export class ProjectileStore {
  /** Verarbeitungsreihenfolge inklusive bereits zum Abbau vorgemerkter Records. */
  private readonly records: ProjectileRuntimeRecord[] = [];
  private readonly active = new Set<ProjectileRuntimeRecord>();
  private readonly byId = new Map<ProjectileId, ProjectileRuntimeRecord>();

  constructor(private readonly identityScope: ProjectileIdentityScope) {}

  /** Vergibt die nächste Identity über die einzige ID-Quelle dieser World-Revision. */
  allocateId(): ProjectileId {
    return this.identityScope.allocate();
  }

  /** Nimmt einen fertig erzeugten Record in Identity, Aktivmenge und Verarbeitung auf. */
  insert(record: ProjectileRuntimeRecord): void {
    this.records.push(record);
    this.active.add(record);
    this.byId.set(record.id, record);
  }

  /** Stabile, allokationsfreie Sicht in Verarbeitungsreihenfolge. */
  get stepOrder(): readonly ProjectileRuntimeRecord[] {
    return this.records;
  }

  /** Stabile, allokationsfreie Sicht auf die noch wirksamen Projectiles. */
  get activeRecords(): ReadonlySet<ProjectileRuntimeRecord> {
    return this.active;
  }

  get activeCount(): number {
    return this.active.size;
  }

  getById(id: ProjectileId): ProjectileRuntimeRecord | undefined {
    return this.byId.get(id);
  }

  /**
   * Nimmt einen Record aus der Aktivmenge, ohne seine Identity zu beenden.
   *
   * Ein zum Abbau vorgemerktes Projectile verlässt die Aktivmenge sofort, bleibt für den
   * verzögerten Cleanup aber auffindbar.
   */
  deactivate(record: ProjectileRuntimeRecord): void {
    this.active.delete(record);
  }

  /** Beendet Identity und Aktivmenge; der Record bleibt bis zum Drop in der Verarbeitung. */
  detach(record: ProjectileRuntimeRecord): void {
    this.active.delete(record);
    this.byId.delete(record.id);
  }

  /** Entfernt den Eintrag an dieser Position aus der Verarbeitungsreihenfolge. */
  dropStepEntryAt(index: number): void {
    this.records.splice(index, 1);
  }

  /** Position des Records in der Verarbeitungsreihenfolge; `-1`, wenn er dort fehlt. */
  indexOfStepEntry(record: ProjectileRuntimeRecord): number {
    return this.records.indexOf(record);
  }

  /** Leert Identity, Aktivmenge und Verarbeitungsreihenfolge. */
  clear(): void {
    this.records.length = 0;
    this.active.clear();
    this.byId.clear();
  }
}
