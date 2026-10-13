export interface ResolvedFireControlRelayConfig {
  readonly durationMs: number;
  readonly cooldownMs: number;
  readonly maxCopies: number;
  readonly parallel: boolean;
  readonly placementRangePx: number;
  readonly ringRadiusPx: number;
  readonly clearanceRadiusPx: number;
  readonly singleCopyOffsetPx: number;
  readonly materializeMs: number;
}

export type FireControlActivation =
  | { readonly ok: true; readonly deploymentId: number; readonly expiresAt: number }
  | { readonly ok: false; readonly reason: 'invalid' | 'placement' | 'no_fire_sources' | 'blocked' };

export interface FireControlUtilityPort {
  activateCopies(request: {
    readonly ownerId: string; readonly ownerColor: number;
    readonly playerX: number; readonly playerY: number;
    readonly pointX: number; readonly pointY: number;
    readonly nowMs: number; readonly config: ResolvedFireControlRelayConfig;
  }): FireControlActivation;
  /** Silent removal: no end callback and no cooldown. */
  removeOwner(ownerId: string): void;
}
