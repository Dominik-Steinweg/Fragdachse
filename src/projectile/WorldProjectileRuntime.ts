import type { ProjectileSpawnConfig, TrackedProjectile } from '../types';
import type { WorldScopedBinding } from '../world/WorldRuntime';
import { toLegacyProjectileSpawnConfig } from './legacyProjectileSpawnPayload';
import type { ProjectileId, ProjectileSpawnPort, ProjectileSpawnResult } from './ProjectileSpawnPort';
import type { ProjectileSpawnRequest } from './ProjectileSpawnRequest';
import { ProjectileStore, type LegacyProjectileStoreAccess } from './ProjectileStore';

/**
 * Noch nicht migrierte Host-Simulation eines Projectiles (`03 §5.1`).
 *
 * Sie erzeugt und entsorgt weiterhin Physics-Handle, Collider und Darstellung, besitzt aber weder
 * Identity noch Registry: beides liegt beim Owner. Jede hier genannte Operation entfällt mit dem
 * Cutover ihres Fachbereichs (Phasen 3–14).
 */
export interface LegacyProjectileHostSimulation {
  /** Verbindet die Legacy-Verarbeitung mit dem kanonischen Store dieser World. */
  bindProjectileOwner(owner: ProjectileOwnerSeam | null): void;
  /** Baut Physics-Handle, Collider, Spawn-Darstellung und Runtime-Record zu einer vergebenen Id. */
  createProjectile(
    id: ProjectileId,
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
    hostNowMs: number,
  ): TrackedProjectile;
  /** Gibt Physics-, Collider- und Darstellungsressourcen eines entfernten Records frei. */
  releaseProjectileResources(record: TrackedProjectile): void;
  /** Räumt den registry-fremden Rest ab: Renderer, Snapshot-Zustand und Client-Visuals. */
  releaseWorldProjectileState(): void;
}

/**
 * Owner-vermittelte Operationen für den noch nicht migrierten Host-Code (`03 §5.1`).
 *
 * Der Seam zeigt ausschließlich auf denselben kanonischen Store; er kopiert nichts, vergibt keine
 * zweite Identity und wird nicht an neue Consumer verteilt.
 */
export interface ProjectileOwnerSeam {
  readonly store: LegacyProjectileStoreAccess;
  /** Spawn im Legacy-Payload-Shape der noch nicht migrierten Quellen. */
  spawnLegacyProjectile(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): ProjectileId;
  /** Entfernt ein Projectile vollständig; unbekannte Ids sind wirkungslos. */
  destroyProjectile(id: ProjectileId): void;
  /** Beendet Identity und Aktivmenge und gibt die Ressourcen frei; der Step-Eintrag bleibt. */
  releaseProjectile(record: TrackedProjectile): void;
}

export interface WorldProjectileRuntimeOptions {
  readonly simulation: LegacyProjectileHostSimulation;
  /** Hostautoritative Frame-/Weltzeit; die Runtime liest keine eigene Wall Clock. */
  readonly hostNowMs: () => number;
  /** Meldet der Composition, dass dieser Owner abgeräumt ist. */
  readonly onDestroy?: () => void;
}

/**
 * World-owned Owner der autoritativen Projectile-Registry.
 *
 * Er lebt und stirbt mit seiner `WorldRuntime`: Identity, Runtime-Records und ihr Teardown gehören
 * ihm allein. Spawn läuft ausschließlich über diese Grenze – aus der aufgelösten Execution über
 * {@link spawnProjectile}, aus noch nicht migrierten Host-Quellen über den befristeten Seam.
 *
 * Flight, Kollision, Wirkung und Darstellung liegen bis zu ihren Cutover-Phasen weiterhin in der
 * Legacy-Simulation; sie arbeitet dabei auf **demselben** Store, nie auf einer Kopie.
 */
export class WorldProjectileRuntime implements ProjectileSpawnPort, ProjectileOwnerSeam, WorldScopedBinding {
  private readonly projectiles = new ProjectileStore();
  private readonly simulation: LegacyProjectileHostSimulation;
  private readonly hostNowMs: () => number;
  private readonly onDestroy?: () => void;
  private destroyed = false;

  constructor(options: WorldProjectileRuntimeOptions) {
    this.simulation = options.simulation;
    this.hostNowMs = options.hostNowMs;
    this.onDestroy = options.onDestroy;
    this.simulation.bindProjectileOwner(this);
  }

  get store(): LegacyProjectileStoreAccess {
    return this.projectiles;
  }

  /** Anzahl der aktuell wirksamen Projectiles dieser World. */
  get activeCount(): number {
    return this.projectiles.activeCount;
  }

  spawnProjectile(request: ProjectileSpawnRequest): ProjectileSpawnResult {
    const { origin } = request;
    return this.spawnResolved(
      origin.x,
      origin.y,
      origin.angle,
      request.provenance.attributionId,
      toLegacyProjectileSpawnConfig(request),
    );
  }

  spawnLegacyProjectile(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): ProjectileId {
    return this.spawnResolved(x, y, angle, ownerId, cfg);
  }

  destroyProjectile(id: ProjectileId): void {
    const record = this.projectiles.getById(id);
    if (!record) return;
    const index = this.projectiles.indexOfStepEntry(record);
    if (index === -1) return;
    this.releaseProjectile(record);
    this.projectiles.dropStepEntryAt(index);
  }

  releaseProjectile(record: TrackedProjectile): void {
    this.projectiles.detach(record);
    this.simulation.releaseProjectileResources(record);
  }

  /** World-Teardown: kein Record, kein Identity-Eintrag und kein Restzustand überlebt ihn. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const record of this.projectiles.stepOrder) {
      this.projectiles.detach(record);
      this.simulation.releaseProjectileResources(record);
    }
    this.projectiles.clear();
    this.simulation.releaseWorldProjectileState();
    this.simulation.bindProjectileOwner(null);
    this.onDestroy?.();
  }

  private spawnResolved(
    x: number,
    y: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): ProjectileId {
    const id = this.projectiles.allocateId();
    const record = this.simulation.createProjectile(id, x, y, angle, ownerId, cfg, this.hostNowMs());
    this.projectiles.insert(record);
    return id;
  }
}
