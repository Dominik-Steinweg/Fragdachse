import type {
  GroundFireVisualStyle,
  ImpactCloudConfig,
  ProjectileEnergyInjectorPayload,
  ProjectileProximityPulseConfig,
  ProjectileStyle,
  ShotAudioKey,
} from '../types';
import type { ProjectileProvenance } from './ProjectileSpawnRequest';

/** Stable combat read for chain reactions; no Runtime record crosses this boundary. */
export interface ProjectileDetonableSample {
  readonly projectileId: number;
  readonly ownerId: string;
  readonly x: number;
  readonly y: number;
  readonly tag: string;
  readonly allowCrossTeam: boolean;
}

export interface ProjectileDetonableReadPort {
  readDetonableProjectiles(sink: (sample: ProjectileDetonableSample) => void): void;
}

/** Read-only source data for host gameplay reactions; Runtime records stay private. */
export interface ProjectileImpactSource {
  readonly projectileId: number;
  readonly ownerId: string;
  readonly provenance: ProjectileProvenance;
  readonly x: number;
  readonly y: number;
  readonly velocityX: number;
  readonly velocityY: number;
  readonly color: number;
  readonly ownerColor?: number;
  readonly sourceId: string;
  readonly sourceSlot?: import('../types').LoadoutSlot;
  readonly allowTeamDamage?: boolean;
  readonly damage: number;
  readonly ak47DamageMultiplier?: number;
  readonly baseDamageMult?: number;
  readonly rockDamageMult?: number;
  readonly trainDamageMult?: number;
  readonly impactCloud?: ImpactCloudConfig;
  readonly energyInjectorPayload?: ProjectileEnergyInjectorPayload;
  readonly proximityPulse?: ProjectileProximityPulseConfig;
  readonly isBfg?: boolean;
  readonly isFlame?: boolean;
  readonly hitboxSize?: number;
  readonly hitboxMaxSize?: number;
  readonly bodyWidth?: number;
  readonly projectileStyle?: ProjectileStyle;
  readonly projectileBurnVisualStyle?: GroundFireVisualStyle;
  readonly shotAudioKey?: ShotAudioKey;
  readonly shotgunProximityMaxDamageBonus?: number;
  readonly shotgunOriginX?: number;
  readonly shotgunOriginY?: number;
  readonly shotgunResolvedRange?: number;
}

export interface ProjectileFlameExpiryEvent extends ProjectileImpactSource {
  readonly x: number;
  readonly y: number;
}

export interface ProjectileResolvedOutcome {
  readonly kind: 'resolved';
  readonly projectileId: number;
  readonly provenance: ProjectileProvenance;
  readonly reaction?: {
    readonly ak47?: {
      readonly shotId: number;
      readonly fireSuperiorityShot: boolean;
      readonly hitConfirmed: boolean;
    };
  };
}

/** Resource and presentation data for a Mini-Rocket pickup. */
export interface MiniRocketPickupSpec {
  readonly x: number;
  readonly y: number;
  readonly color: number;
  readonly ownerColor?: number;
  readonly adrenalineRefund: number;
  readonly armorRefund: number;
}

export interface ProjectileMiniRocketCollectedOutcome {
  readonly kind: 'mini-rocket-collected';
  readonly projectileId: number;
  readonly collectorId: string;
  readonly pickup: MiniRocketPickupSpec;
}

export interface ProjectileMiniRocketDestroyedOutcome {
  readonly kind: 'mini-rocket-destroyed';
  readonly projectileId: number;
}

export type ProjectileLifecycleOutcome =
  | ProjectileResolvedOutcome
  | ProjectileMiniRocketCollectedOutcome
  | ProjectileMiniRocketDestroyedOutcome;
