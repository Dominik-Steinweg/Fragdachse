import type {
  BurnOnHitConfig,
  ChainLightningConfig,
  DetonatorConfig,
  HitscanSupportEffect,
  HitscanVisualPreset,
  LoadoutSlot,
  MeleeDamageTarget,
  MeleeVisualPreset,
  ProjectileSpawnConfig,
  ShotAudioKey,
  WeaponSlot,
} from '../types';
import type {
  HitscanWeaponFireConfig,
  MeleeWeaponFireConfig,
  ProjectileWeaponFireConfig,
  WeaponConfig,
} from './LoadoutConfig';
import { getTopDownMuzzleOrigin, type MuzzleOrigin } from '../config';

/**
 * Fire-Typen, die Ã¼ber einen gemeinsamen, zustandsarmen Pfad laufen und deshalb auch auÃŸerhalb
 * eines Matches (lokale Lobby-Inszenierung) benutzbar sind.
 *
 * Alle Ã¼brigen Typen â€“ Flammenwerfer, LaubblÃ¤ser, Tesla-Kuppel, Heilaura, Energieschild,
 * VerstÃ¤rkungsmatrix, Energieinjektor â€“ hÃ¤ngen an Ressourcen-, Runden- oder Netzwerkzustand.
 * Sie werden **nicht** vereinfacht nachgebaut; sie sind schlicht nicht Ambient-kompatibel.
 */
export const AMBIENT_COMPATIBLE_FIRE_TYPES = ['projectile', 'hitscan', 'melee'] as const;

export type AmbientCompatibleFireType = typeof AMBIENT_COMPATIBLE_FIRE_TYPES[number];

/** Ist der Fire-Typ dieser Waffe Ã¼ber den gemeinsamen Executor abbildbar? */
export function isAmbientCompatibleWeapon(config: WeaponConfig): boolean {
  return (AMBIENT_COMPATIBLE_FIRE_TYPES as readonly string[]).includes(config.fire.type);
}

/** Normalisierter Hitscan-Schuss â€“ frei von Waffen-, Ressourcen- und Netzwerkwissen. */
export interface HitscanShotRequest {
  shooterId:       string;
  startX:          number;
  startY:          number;
  angle:           number;
  range:           number;
  damage:          number;
  traceThickness:  number;
  color:           number;
  adrenalinGain:   number;
  sourceId:      string;
  visualPreset:    HitscanVisualPreset;
  shotAudioKey?:   ShotAudioKey;
  sourceSlot?:     WeaponSlot;
  shotId?:         number;
  detonator?:      DetonatorConfig;
  rockDamageMult:  number;
  trainDamageMult: number;
  baseDamageMult:  number;
  chainLightning?: ChainLightningConfig;
  burnOnHit?:      BurnOnHitConfig;
  supportEffect?:  HitscanSupportEffect;
  /** Reiner Renderursprung; Gameplay-Hitscan bleibt bei startX/startY. */
  visualMuzzleOrigin?: MuzzleOrigin;
}

/** Normalisierter Nahkampfschlag. */
export interface MeleeSwingRequest {
  shooterId:             string;
  x:                     number;
  y:                     number;
  angle:                 number;
  range:                 number;
  arcDegrees:            number;
  damage:                number;
  adrenalinGain:         number;
  sourceId:            string;
  color:                 number;
  sourceSlot?:           WeaponSlot;
  rockDamageMult:        number;
  trainDamageMult:       number;
  baseDamageMult:        number;
  visualPreset:          MeleeVisualPreset;
  shotAudioKey?:         ShotAudioKey;
  burnOnHit?:            BurnOnHitConfig;
  hitHeal:               number;
  hitAdrenaline:         number;
  bloodEffectMultiplier: number;
  damageTargets?:        readonly MeleeDamageTarget[];
}

/**
 * Ziel der drei gemeinsamen Fire-Pfade.
 *
 * Im Gameplay fÃ¼llt der `LoadoutManager` diese Grenze mit `ProjectileManager` und
 * `CombatSystem`; in der Lobby liegt dahinter der lokale Ambient-Projektilmanager und ein
 * lokaler Treffer-Resolver. Der Executor selbst kennt keine der beiden Seiten.
 */
export interface WeaponFireSink {
  spawnProjectile(x: number, y: number, angle: number, ownerId: string, cfg: ProjectileSpawnConfig): void;
  resolveHitscan(request: HitscanShotRequest): boolean;
  resolveMelee(request: MeleeSwingRequest): boolean;
}

/** Zusatzangaben automatischer Feuerquellen (TÃ¼rme, Konstrukte). */
export interface WeaponFireOptions {
  ignoreBaseCollisions?: boolean;
  ignoreRockIndex?: number;
  sourceSlot?: LoadoutSlot;
  /** Quellkonstrukt eines automatischen Turms fuer typisierte Projektilwirkungen. */
  sourceTurretId?: string;
  /** Orts-/konstruktspezifischer Faktor fuer den unmittelbaren Treffer. */
  directDamageMultiplier?: number;
  /** Gesamtfaktor fuer Folgeschaden, der nicht erneut durch den Projektiltreffer-Resolver laeuft. */
  payloadDamageMultiplier?: number;
}

/** Aufrufkontext eines einzelnen Schusses. */
export interface WeaponFireParams {
  x:           number;
  y:           number;
  angle:       number;
  /** Cursorziel; steuert reichweitenbegrenzte Projektile. Ohne Cursor gleich `x`/`y` + Richtung. */
  targetX:     number;
  targetY:     number;
  ownerId:     string;
  ownerColor:  number;
  /** Visueller MÃ¼ndungsursprung; verschiebt niemals den Gameplay-Spawn. */
  visualMuzzleOrigin?: MuzzleOrigin;
  sourceSlot?: LoadoutSlot;
  shotId?:     number;
  options?:    WeaponFireOptions;
  /**
   * Bereits gezahlte Adrenalinkosten der Mini-Rakete. Wird nur fÃ¼r diese eine Waffe abgefragt,
   * damit der Executor selbst keine Ressourcenverwaltung braucht. Ambient liefert nichts.
   */
  resolvePaidAdrenalineCost?: () => number;
}

/**
 * Zustandsarmer Fire-Dispatch fÃ¼r die Ambient-kompatiblen Waffentypen.
 *
 * Er Ã¼bersetzt eine {@link WeaponConfig} in Projektil-, Hitscan- oder Melee-AuftrÃ¤ge und hÃ¤lt
 * dabei **keine** Ressourcenverwaltung, Progression, Items, Netzwerklogik oder Matchstatistik.
 * Genau diese Trennung erlaubt es der Lobby, echte Waffen zu zeigen, ohne eine zweite
 * Waffenmechanik zu bauen.
 */
export class WeaponFireExecutor {
  constructor(private readonly sink: WeaponFireSink) {}

  /**
   * FÃ¼hrt den Schuss aus. Gibt `false` zurÃ¼ck, wenn der Fire-Typ nicht Ã¼ber diesen gemeinsamen
   * Pfad lÃ¤uft â€“ der Aufrufer entscheidet dann selbst, ob er einen Spezialpfad hat.
   */
  fire(config: WeaponConfig, params: WeaponFireParams): boolean {
    switch (config.fire.type) {
      case 'projectile':
        return this.fireProjectile(config, config.fire, params);
      case 'hitscan':
        return this.fireHitscan(config, config.fire, params);
      case 'melee':
        return this.fireMelee(config, config.fire, params);
      default:
        return false;
    }
  }

  private fireProjectile(
    config: WeaponConfig,
    fireConfig: ProjectileWeaponFireConfig,
    params: WeaponFireParams,
  ): boolean {
    const { x, y, angle, targetX, targetY, ownerId, ownerColor, sourceSlot, options, visualMuzzleOrigin } = params;
    const cursorRange = Math.hypot(targetX - x, targetY - y);
    const effectiveRange = fireConfig.limitRangeToCursor
      ? Math.min(config.range, cursorRange)
      : config.range;
    const lifetime = (effectiveRange / fireConfig.projectileSpeed) * 1000;
    const isMiniRocket = config.id === 'MINI_ROCKET_LAUNCHER';
    const hasExtendedMiniRocketFlight = isMiniRocket
      && ((config.multiExplosionCount ?? 1) > 1 || (config.miniRocketReturnEnabled ?? 0) > 0);
    const isShotgun = (config.pelletCount ?? 1) > 1;
    const hasAwpCorridor = config.id === 'AWP' && (config.awpCharge?.corridorEnabled ?? 0) > 0;
    const plasmaSwarmEnabled = config.id === 'PLASMA'
      && sourceSlot === 'weapon1'
      && (config.plasmaSwarmEnabled ?? 0) > 0;

    this.sink.spawnProjectile(x, y, angle, ownerId, {
      speed:           fireConfig.projectileSpeed,
      ignoreBaseCollisions: options?.ignoreBaseCollisions,
      ignoreRockIndex: options?.ignoreRockIndex,
      sourceTurretId:     options?.sourceTurretId,
      size:            fireConfig.projectileSize,
      damage:          config.directDamageOverride ?? config.damage,
      color:           config.projectileColor ?? ownerColor,  // Waffen-eigene Farbe hat Vorrang
      ownerColor,
      visualMuzzleOrigin,
      projectileVisualScale: config.projectileVisualScale,
      smokeTrailColor: config.rocketSmokeTrailColor ?? ownerColor,
      lifetime: hasExtendedMiniRocketFlight ? (config.miniRocketSafetyLifetimeMs ?? 12_000) : lifetime,
      maxBounces:      fireConfig.projectileMaxBounces,
      isGrenade:       false,
      adrenalinGain:   config.adrenalinGain,
      sourceId:      config.id,
      plasmaSwarmEnabled,
      plasmaSwarmProjectileCount: plasmaSwarmEnabled ? config.plasmaSwarmProjectileCount : undefined,
      plasmaSwarmExplosionRadius: plasmaSwarmEnabled ? config.plasmaSwarmExplosionRadius : undefined,
      plasmaSwarmExplosionDamage: plasmaSwarmEnabled ? config.plasmaSwarmExplosionDamage : undefined,
      plasmaSwarmExplosionSlowFraction: plasmaSwarmEnabled ? config.plasmaSwarmExplosionSlowFraction : undefined,
      splitCount:      config.splitCount,
      splitSpread:     config.splitSpread,
      splitFactor:     config.splitFactor,
      splitHoming:     (config.splitHomingEnabled ?? 0) > 0 ? {
        acquireDelayMs: 0,
        searchRadius: 500,
        // Wie die Basis-Waffen: Splitter treten in groÃŸer Zahl auf, und jede Zielsuche
        // kostet eine SichtlinienprÃ¼fung je geprÃ¼ftem Kandidaten.
        retargetIntervalMs: 100,
        maxTurnDegreesPerStep: 20,
        targetTypes: ['players', 'enemies', 'bases'],
        requireLineOfSight: true,
        excludeOwner: true,
        distanceWeight: 1,
        forwardWeight: 0.5,
      } : undefined,
      remainingRangePx: effectiveRange,
      explosion:       fireConfig.impactExplosion,
      enemyHitExplosion: fireConfig.enemyHitExplosion,
      impactCloud:     fireConfig.impactCloud,
      sporeVisualVariant: config.projectileStyle === 'spore'
        ? fireConfig.impactCloud?.visualVariant === 'spore_void' ? 'spore_void' : 'spore'
        : undefined,
      homing:          config.homingEnabled === undefined || config.homingEnabled > 0
        ? fireConfig.homing
        : undefined,
      projectileStyle: config.projectileStyle,
      bulletVisualPreset: config.bulletVisualPreset,
      grenadeVisualPreset: config.grenadeVisualPreset,
      energyBallVariant: config.energyBallVariant,
      tracerConfig:    config.tracerConfig,
      detonable:       config.detonable,
      detonator:       config.detonator,
      rockDamageMult:  config.rockDamageMult,
      trainDamageMult: config.trainDamageMult,
      baseDamageMult:  config.baseDamageMult ?? 1,
      // Brennende Kugeln (z.B. Glock/Negev-Upgrade): Burn-Felder aufs Projektil Ã¼bertragen.
      burnDurationMs:     config.burnOnHit?.durationMs,
      burnDamagePerTick:  config.burnOnHit?.damagePerTick,
      projectileBurnVisualStyle: config.projectileBurnVisualStyle,
      canReceiveFireImbue: sourceSlot === 'weapon1' || sourceSlot === 'weapon2',
      sourceSlot,
      shotAudioKey:    config.shotAudio?.successKey,
      penetrationCount: config.penetrationCount,
      penetrationDamageRetention: config.penetrationDamageRetention,
      penetratesRocks: (config.penetratesRocks ?? 0) > 0,
      multiExplosionCount: config.multiExplosionCount,
      multiExplosionCoastMs: isMiniRocket ? config.multiExplosionCoastMs : undefined,
      miniRocketStageRangePx: hasExtendedMiniRocketFlight ? effectiveRange : undefined,
      miniRocketReturnEnabled: isMiniRocket && (config.miniRocketReturnEnabled ?? 0) > 0,
      miniRocketReturnRangeBuffer: isMiniRocket ? config.miniRocketReturnRangeBuffer : undefined,
      miniRocketPickupRadius: isMiniRocket ? config.miniRocketPickupRadius : undefined,
      miniRocketPickupAdrenalineRefundFraction: isMiniRocket ? config.miniRocketPickupAdrenalineRefundFraction : undefined,
      miniRocketPickupArmor: isMiniRocket ? config.miniRocketPickupArmor : undefined,
      miniRocketAdrenalineCostPaid: isMiniRocket
        ? (params.resolvePaidAdrenalineCost?.() ?? 0)
        : undefined,
      miniRocketSafetyLifetimeMs: hasExtendedMiniRocketFlight ? (config.miniRocketSafetyLifetimeMs ?? 12_000) : undefined,
      miniRocketCascadeDamageBonusPerExplosion: isMiniRocket ? config.miniRocketCascadeDamageBonusPerExplosion : undefined,
      shotgunOriginX: isShotgun ? x : undefined,
      shotgunOriginY: isShotgun ? y : undefined,
      shotgunResolvedRange: isShotgun ? effectiveRange : undefined,
      shotgunProximityMaxDamageBonus: isShotgun ? config.shotgunProximityMaxDamageBonus : undefined,
      shotgunSlowFraction: isShotgun ? config.shotgunSlowFraction : undefined,
      shotgunSlowDurationMs: isShotgun ? config.shotgunSlowDurationMs : undefined,
      hitSlowFraction: config.hitSlowFraction,
      hitSlowDurationMs: config.hitSlowDurationMs,
      hitKnockback: config.hitKnockback,
      hitKnockbackDurationMs: config.hitKnockbackDurationMs,
      fireTrail: config.id === 'AWP' && (config.awpCharge?.fireTrailDurationMs ?? 0) > 0 ? {
        durationMs: config.awpCharge?.fireTrailDurationMs ?? 0,
        burnDurationMs: config.awpCharge?.fireTrailBurnDurationMs ?? 0,
        burnDamagePerTick: config.awpCharge?.fireTrailBurnDamagePerTick ?? 0,
        sourceId: 'weapon.AWP.fire_trail',
        baseDamageMult: config.baseDamageMult ?? 1,
      } : undefined,
      fireTrailHalfWidthCells: config.id === 'AWP' ? config.awpCharge?.fireTrailHalfWidthCells : undefined,
      awpCorridorHalfWidth: hasAwpCorridor ? config.awpCharge?.corridorHalfWidth : undefined,
      awpCorridorDamage: hasAwpCorridor ? config.awpCharge?.corridorDamage : undefined,
      awpCorridorDotDurationMs: hasAwpCorridor ? config.awpCharge?.corridorDotDurationMs : undefined,
      awpCorridorDotTickIntervalMs: hasAwpCorridor ? config.awpCharge?.corridorDotTickIntervalMs : undefined,
      awpCorridorKnockback: hasAwpCorridor ? config.awpCharge?.corridorKnockback : undefined,
      awpCorridorKnockbackDurationMs: hasAwpCorridor ? config.awpCharge?.corridorKnockbackDurationMs : undefined,
      proximityArc: config.proximityArc,
      ak47ShotId: config.ak47ShotId,
      ak47DamageMultiplier: config.ak47DamageMultiplier,
      ak47FireSuperiorityShot: config.ak47FireSuperiorityShot,
    });

    return true;
  }

  private fireHitscan(
    config: WeaponConfig,
    fireConfig: HitscanWeaponFireConfig,
    params: WeaponFireParams,
  ): boolean {
    const gameplayMuzzleOrigin = getTopDownMuzzleOrigin(params.x, params.y, params.angle);
    return this.sink.resolveHitscan({
      shooterId:       params.ownerId,
      startX:          gameplayMuzzleOrigin.x,
      startY:          gameplayMuzzleOrigin.y,
      angle:           params.angle,
      range:           config.range,
      damage:          config.damage,
      traceThickness:  fireConfig.traceThickness,
      color:           params.ownerColor,
      adrenalinGain:   config.adrenalinGain,
      sourceId:      config.id,
      visualPreset:    fireConfig.visualPreset ?? 'default',
      shotAudioKey:    config.shotAudio?.successKey,
      sourceSlot:      params.sourceSlot as WeaponSlot | undefined,
      shotId:          params.shotId,
      detonator:       config.detonator,
      rockDamageMult:  config.rockDamageMult  ?? 1,
      trainDamageMult: config.trainDamageMult ?? 1,
      baseDamageMult:  config.baseDamageMult  ?? 1,
      chainLightning:  config.chainLightning,
      burnOnHit:       config.burnOnHit,
      supportEffect:   fireConfig.supportEffect,
      visualMuzzleOrigin: params.visualMuzzleOrigin,
    });
  }

  private fireMelee(
    config: WeaponConfig,
    fireConfig: MeleeWeaponFireConfig,
    params: WeaponFireParams,
  ): boolean {
    return this.sink.resolveMelee({
      shooterId:             params.ownerId,
      x:                     params.x,
      y:                     params.y,
      angle:                 params.angle,
      range:                 config.range,
      arcDegrees:            fireConfig.hitArcDegrees,
      damage:                config.damage,
      adrenalinGain:         config.adrenalinGain,
      sourceId:            config.id,
      color:                 params.ownerColor,
      sourceSlot:            params.sourceSlot as WeaponSlot | undefined,
      rockDamageMult:        config.rockDamageMult  ?? 1,
      trainDamageMult:       config.trainDamageMult ?? 1,
      baseDamageMult:        config.baseDamageMult  ?? 1,
      visualPreset:          fireConfig.visualPreset ?? 'default',
      shotAudioKey:          config.shotAudio?.successKey,
      burnOnHit:             config.burnOnHit,
      hitHeal:               config.hitHeal ?? 0,
      hitAdrenaline:         config.hitAdrenaline ?? 0,
      bloodEffectMultiplier: config.bloodEffectMultiplier ?? 1,
      damageTargets:         fireConfig.damageTargets,
    });
  }
}
