/** Authored flight/size tuning shared by the HE payload resolver and upgrade presentation. */
export interface GrenadeFragmentConfig {
  readonly shortFraction: number;
  readonly shortDistance: readonly number[];
  readonly longDistance: readonly number[];
  readonly fuseMs: readonly number[];
  readonly stationaryHalfAngleDeg: number;
  readonly movingHalfAngleDeg: number;
  readonly speedDistanceBias: number;
  readonly projectileSize: number;
  readonly demolition: {
    readonly count: number;
    readonly distance: readonly number[];
    readonly radiusFactor: number;
    readonly damageFactors: readonly number[];
    readonly fuseMs: readonly number[];
    readonly projectileSize: number;
  };
}
