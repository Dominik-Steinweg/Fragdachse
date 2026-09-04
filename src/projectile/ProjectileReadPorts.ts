import type { ProjectileStyle } from '../types';
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

/** Presentation-only Summary-Query; Simulation interprets keine Presentation-Metadaten. */
export interface ProjectilePresentationReadPort {
  hasActiveProjectileStyle(style: ProjectileStyle): boolean;
}
