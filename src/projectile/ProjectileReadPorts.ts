import type { ProjectileProvenance } from './ProjectileSpawnRequest';
import type { ProjectileId } from './ProjectileSpawnPort';

export interface ProjectileThreatSample {
  readonly id: ProjectileId;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly provenance: ProjectileProvenance;
  readonly dodgeRelevant: boolean;
}

export interface ProjectileThreatReadPort {
  getThreatSamples(): readonly ProjectileThreatSample[];
}

export interface ProjectileDiagnosticsSummary {
  readonly activeCount: number;
  readonly activeProjectilesByOwner: ReadonlyMap<string, number>;
}

export interface ProjectileDiagnosticsReadPort {
  getSummary(): ProjectileDiagnosticsSummary;
}

/** Presentation-only semantic query; gameplay does not inspect visual style metadata. */
export interface ProjectilePresentationReadPort {
  hasActiveBfgProjectile(): boolean;
}
