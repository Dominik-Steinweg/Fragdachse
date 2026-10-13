export interface ResolvedFireControlRelayConfig {
  readonly durationMs: number;
  readonly cooldownMs: number;
  readonly maxCopies: number;
  readonly parallel: boolean;
  /** Player construction placement range, resolved once at activation. */
  readonly buildRangePx: number;
  readonly ringRadiusPx: number;
  readonly clearanceRadiusPx: number;
  readonly singleCopyOffsetPx: number;
  readonly materializeMs: number;
}

/** Portal utility values, frozen at release and again at the deployment (D31). */
export interface ResolvedFireControlPortalConfig {
  readonly durationMs: number;
  readonly cooldownMs: number;
  /** Additive damage bonus of transported shots, applied once per deployment and projectile. */
  readonly damageBonus: number;
  /** Boss node "Lokale Feuerfreigabe": sources without an exit target fight locally. */
  readonly localFireRelease: boolean;
  /** Landing clearance (D34), shared by the host landing and the client preview. */
  readonly exitClearanceRadiusPx: number;
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
  /** Eligibility before any consumption: at least one current portal source of the owner. */
  hasPortalSources(ownerId: string, nowMs: number): boolean;
  /**
   * Opens the exit where the device came to rest. An invalid rest point is moved back along the
   * flight towards the release point (D34); a portal throw never fails because of its landing.
   */
  activatePortal(request: {
    readonly ownerId: string; readonly ownerColor: number;
    readonly originX: number; readonly originY: number;
    readonly restX: number; readonly restY: number;
    readonly nowMs: number; readonly config: ResolvedFireControlPortalConfig;
  }): FireControlActivation;
  /** Silent cleanup of a flying portal device (no payload, no callback). */
  discardPortalProjectile(projectileId: number): void;
  /** Silent removal: no end callback and no cooldown. */
  removeOwner(ownerId: string): void;
}
