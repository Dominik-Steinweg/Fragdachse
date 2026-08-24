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
 * Fire-Typen, die über einen gemeinsamen, zustandsarmen Pfad laufen und deshalb auch außerhalb
 * eines Matches (lokale Lobby-Inszenierung) benutzbar sind.
 *
 * Alle übrigen Typen – Flammenwerfer, Laubbläser, Tesla-Kuppel, Heilaura, Energieschild,
 * Verstärkungsmatrix, Energieinjektor – hängen an Ressourcen-, Runden- oder Netzwerkzustand.
 * Sie werden **nicht** vereinfacht nachgebaut; sie sind schlicht nicht Ambient-kompatibel.
 */
export const AMBIENT_COMPATIBLE_FIRE_TYPES = ['projectile', 'hitscan', 'melee'] as const;

export type AmbientCompatibleFireType = typeof AMBIENT_COMPATIBLE_FIRE_TYPES[number];

/** Ist der Fire-Typ dieser Waffe über den gemeinsamen Executor abbildbar? */
export function isAmbientCompatibleWeapon(config: WeaponConfig): boolean {
  return (AMBIENT_COMPATIBLE_FIRE_TYPES as readonly string[]).includes(config.fire.type);
}

/** Normalisierter Hitscan-Schuss – frei von Waffen-, Ressourcen- und Netzwerkwissen. */
export interface HitscanShotRequest {
  shooterId:       string;
  /** Ursprünglicher Fire-Request-Ursprung; fehlt bei rein lokalen Ambient-/Headless-Aufträgen. */
  shooterX?:        number;
  shooterY?:        number;
  /** Gewünschter Gameplay-Start; der Host kann ihn vor dem Trace sicher auflösen. */
  startX:          number;
  startY:          number;
  angle:           number;
  /** Authorisierte Maximalreichweite vor einer optionalen Cursorbegrenzung. */
  range:           number;
  /** Nur für Cursor-begrenzte direkte Hitscan-Waffen wie den Plasmabrenner. */
  rangeLimitToCursor?: boolean;
  targetX?:         number;
  targetY?:         number;
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
 * Im Gameplay füllt der `LoadoutManager` diese Grenze mit `ProjectileManager` und
 * `CombatSystem`; in der Lobby liegt dahinter der lokale Ambient-Projektilmanager und ein
 * lokaler Treffer-Resolver. Der Executor selbst kennt keine der beiden Seiten.
 */
export interface WeaponFireSink {
  spawnProjectile(x: number, y: number, angle: number, ownerId: string, cfg: ProjectileSpawnConfig): boolean | void;
  resolveHitscan(request: HitscanShotRequest): boolean;
  resolveMelee(request: MeleeSwingRequest): boolean;
}

/** Zusatzangaben automatischer Feuerquellen (Türme, Konstrukte). */
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
  /** Gewünschter physischer Muzzle-Punkt; der ProjectileManager löst ihn sicher auf. */
  gameplayMuzzleOrigin?: MuzzleOrigin;
  /** Visueller Mündungsursprung; verschiebt niemals den Gameplay-Spawn. */
  visualMuzzleOrigin?: MuzzleOrigin;
  sourceSlot?: LoadoutSlot;
  shotId?:     number;
  options?:    WeaponFireOptions;
  /**
   * Bereits gezahlte Adrenalinkosten der Mini-Rakete. Wird nur für diese eine Waffe abgefragt,
   * damit der Executor selbst keine Ressourcenverwaltung braucht. Ambient liefert nichts.
   */
  resolvePaidAdrenalineCost?: () => number;
}

/**
 * Resolves the effective hitscan range for a weapon that terminates at the cursor.
 *
 * The range is measured from the gameplay muzzle so the replicated trace ends at the
 * cursor instead of overshooting it by the muzzle offset. Other hitscan weapons keep
 * their authored range unchanged.
 */
export function getHitscanRangeToCursor(
  config: Pick<WeaponConfig, 'id' | 'range'>,
  startX: number,
  startY: number,
  angle: number,
  targetX: number,
  targetY: number,
): number {
  if (config.id !== 'PLASMA_BURNER') return config.range;

  const directionX = Math.cos(angle);
  const directionY = Math.sin(angle);
  const cursorDistance = Math.max(
    0,
    (targetX - startX) * directionX + (targetY - startY) * directionY,
  );
  return Math.min(config.range, cursorDistance);
}

/** Ermittelt die effektive Reichweite eines internen Hitscan-Auftrags ab einem konkreten Start. */
export function getHitscanRequestRange(
  request: Pick<HitscanShotRequest, 'sourceId' | 'range' | 'rangeLimitToCursor' | 'targetX' | 'targetY'>,
  startX: number,
  startY: number,
  angle: number,
): number {
  if (!request.rangeLimitToCursor || request.targetX === undefined || request.targetY === undefined) {
    return request.range;
  }
  return getHitscanRangeToCursor(
    { id: request.sourceId, range: request.range },
    startX,
    startY,
    angle,
    request.targetX,
    request.targetY,
  );
}

/**
 * Zustandsarmer Fire-Dispatch für die Ambient-kompatiblen Waffentypen.
 *
 * Er übersetzt eine {@link WeaponConfig} in Projektil-, Hitscan- oder Melee-Aufträge und hält
 * dabei **keine** Ressourcenverwaltung, Progression, Items, Netzwerklogik oder Matchstatistik.
 * Genau diese Trennung erlaubt es der Lobby, echte Waffen zu zeigen, ohne eine zweite
 * Waffenmechanik zu bauen.
 */
export class WeaponFireExecutor {
  constructor(private readonly sink: WeaponFireSink) {}

  /**
   * Führt den Schuss aus. Gibt `false` zurück, wenn der Fire-Typ nicht über diesen gemeinsamen
   * Pfad läuft – der Aufrufer entscheidet dann selbst, ob er einen Spezialpfad hat.
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
    const {
      x,
      y,
      angle,
      targetX,
      targetY,
      ownerId,
      ownerColor,
      sourceSlot,
      options,
      gameplayMuzzleOrigin,
      visualMuzzleOrigin,
    } = params;
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

    const spawnResult = this.sink.spawnProjectile(x, y, angle, ownerId, {
      speed:           fireConfig.projectileSpeed,
      ignoreBaseCollisions: options?.ignoreBaseCollisions,
      ignoreRockIndex: options?.ignoreRockIndex,
      sourceTurretId:     options?.sourceTurretId,
      size:            fireConfig.projectileSize,
      damage:          config.directDamageOverride ?? config.damage,
      color:           config.projectileColor ?? ownerColor,  // Waffen-eigene Farbe hat Vorrang
      ownerColor,
      gameplayMuzzleOrigin,
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
        // Wie die Basis-Waffen: Splitter treten in großer Zahl auf, und jede Zielsuche
        // kostet eine Sichtlinienprüfung je geprüftem Kandidaten.
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
      // Brennende Kugeln (z.B. Glock/Negev-Upgrade): Burn-Felder aufs Projektil übertragen.
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
      proximityPulse: config.proximityPulse,
      ak47ShotId: config.ak47ShotId,
      ak47DamageMultiplier: config.ak47DamageMultiplier,
      ak47FireSuperiorityShot: config.ak47FireSuperiorityShot,
    });

    return spawnResult !== false;
  }

  private fireHitscan(
    config: WeaponConfig,
    fireConfig: HitscanWeaponFireConfig,
    params: WeaponFireParams,
  ): boolean {
    const desiredGameplayMuzzle = params.gameplayMuzzleOrigin
      ?? getTopDownMuzzleOrigin(params.x, params.y, params.angle);
    const hasGameplayMuzzle = params.gameplayMuzzleOrigin !== undefined;
    return this.sink.resolveHitscan({
      shooterId:       params.ownerId,
      shooterX:        hasGameplayMuzzle ? params.x : undefined,
      shooterY:        hasGameplayMuzzle ? params.y : undefined,
      startX:          desiredGameplayMuzzle.x,
      startY:          desiredGameplayMuzzle.y,
      angle:           params.angle,
      range:           config.range,
      rangeLimitToCursor: config.id === 'PLASMA_BURNER' ? true : undefined,
      targetX:         config.id === 'PLASMA_BURNER' ? params.targetX : undefined,
      targetY:         config.id === 'PLASMA_BURNER' ? params.targetY : undefined,
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
