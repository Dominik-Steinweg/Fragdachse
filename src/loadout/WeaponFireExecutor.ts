import type {
  BurnOnHitConfig,
  ChainLightningConfig,
  DetonatorConfig,
  HitscanSupportEffect,
  HitscanVisualPreset,
  LoadoutSlot,
  MeleeDamageTarget,
  MeleeVisualPreset,
  ShotAudioKey,
  WeaponSlot,
} from '../types';
import type { ProjectileSpawnPort } from '../projectile/ProjectileSpawnPort';
import { createSingleOwnerProvenance } from '../projectile/ProjectileSpawnRequest';
import type {
  HitscanWeaponFireConfig,
  MeleeWeaponFireConfig,
  ProjectileWeaponFireConfig,
  WeaponConfig,
} from './LoadoutConfig';
import { getTopDownMuzzleOrigin, type MuzzleOrigin } from '../config';

/**
 * Fire-Typen, die über einen gemeinsamen, zustandsarmen Pfad laufen und deshalb auch ohne
 * Activity-spezifische Ressourcen- und Netzwerkvertraege benutzbar sind.
 *
 * Alle übrigen Typen – Flammenwerfer, Laubbläser, Tesla-Kuppel, Heilaura, Energieschild,
 * Verstärkungsmatrix, Energieinjektor – hängen an Ressourcen-, Runden- oder Netzwerkzustand.
 * Sie laufen deshalb nicht über diesen zustandsarmen Pfad.
 */
export const AMBIENT_COMPATIBLE_FIRE_TYPES = ['projectile', 'hitscan', 'melee'] as const;

export type AmbientCompatibleFireType = typeof AMBIENT_COMPATIBLE_FIRE_TYPES[number];

/** Ist der Fire-Typ dieser Waffe über den gemeinsamen, zustandsarmen Executor abbildbar? */
export function isAmbientCompatibleWeapon(config: WeaponConfig): boolean {
  return (AMBIENT_COMPATIBLE_FIRE_TYPES as readonly string[]).includes(config.fire.type);
}

/** Normalisierter Hitscan-Schuss – frei von Waffen-, Ressourcen- und Netzwerkwissen. */
export interface HitscanShotRequest {
  shooterId:       string;
  /** Ursprünglicher Fire-Request-Ursprung; fehlt bei rein lokalen oder Headless-Aufträgen. */
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
 * Projektile verlassen die Execution ausschließlich über den semantischen
 * {@link ProjectileSpawnPort}; Hitscan und Melee bleiben bei den bestehenden Combat-Senken. Der
 * world-composed Owner verdrahtet die Grenze; der Executor kennt weder Lifecycle noch die
 * konkrete World-/Activity-Semantik dahinter.
 */
export interface WeaponFireSink extends ProjectileSpawnPort {
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
   * damit der Executor selbst keine Ressourcenverwaltung braucht. Ein Aufruf ohne
   * Ressourcen-Runtime liefert nichts.
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
 * Gemeinsame Immediate-Weapon-Execution-Capability (Cross-Phase-Contract-Familie
 * `WeaponExecutionCapability`, materialisiert in Teilphase 4A).
 *
 * Der einzige Vertrag ist der bereits bestehende {@link WeaponFireExecutor.fire}. Ein world-composed
 * Owner besitzt den Executor und verdrahtet dessen {@link WeaponFireSink} einmalig mit den
 * Legacy-Projectile-/Combat-Pfaden; Player, Gegner, Türme und Allies rufen dieselbe `fire()`.
 */
export interface WeaponExecutionCapability {
  fire(config: WeaponConfig, params: WeaponFireParams): boolean;
}

/**
 * Benannte Capability für unmittelbare Fire-Typen außerhalb des gemeinsamen Projectile-/
 * Hitscan-/Melee-Executors. Sie kennt keine Ressourcen-, Cooldown- oder Player-Lifetime-Regeln.
 */
export interface SpecializedWeaponExecutionCapability {
  fire(config: WeaponConfig, params: WeaponFireParams): boolean;
}

/**
 * Zustandsarmer Fire-Dispatch für die gemeinsamen Projektil-, Hitscan- und Melee-Pfade.
 *
 * Er übersetzt eine {@link WeaponConfig} in Projektil-, Hitscan- oder Melee-Aufträge und hält
 * dabei **keine** Ressourcenverwaltung, Progression, Items, Netzwerklogik oder Matchstatistik.
 * Genau diese Trennung erlaubt es verschiedenen Aufrufern, dieselbe Waffenbeschreibung ohne
 * eine zweite Waffenmechanik zu verwenden.
 */
export class WeaponFireExecutor implements WeaponExecutionCapability {
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

    const isAwp = config.id === 'AWP';

    const spawnResult = this.sink.spawnProjectile({
      origin: { x, y, angle, gameplayMuzzleOrigin },
      flight: {
        speed:      fireConfig.projectileSpeed,
        size:       fireConfig.projectileSize,
        lifetimeMs: hasExtendedMiniRocketFlight ? (config.miniRocketSafetyLifetimeMs ?? 12_000) : lifetime,
        maxBounces: fireConfig.projectileMaxBounces,
        isGrenade:  false,
        remainingRangePx: effectiveRange,
        homing: config.homingEnabled === undefined || config.homingEnabled > 0
          ? fireConfig.homing
          : undefined,
        penetration: {
          count:           config.penetrationCount,
          damageRetention: config.penetrationDamageRetention,
          penetratesRocks: (config.penetratesRocks ?? 0) > 0,
        },
        collisionFilter: {
          ignoreBaseCollisions: options?.ignoreBaseCollisions,
          ignoreRockIndex:      options?.ignoreRockIndex,
        },
        split: {
          count:       config.splitCount,
          spread:      config.splitSpread,
          speedFactor: config.splitFactor,
          homing: (config.splitHomingEnabled ?? 0) > 0 ? {
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
        },
        miniRocket: isMiniRocket ? {
          stageRangePx:  hasExtendedMiniRocketFlight ? effectiveRange : undefined,
          returnEnabled: (config.miniRocketReturnEnabled ?? 0) > 0,
          returnRangeBuffer: config.miniRocketReturnRangeBuffer,
          pickupRadius:  config.miniRocketPickupRadius,
          pickupAdrenalineRefundFraction: config.miniRocketPickupAdrenalineRefundFraction,
          pickupArmor:   config.miniRocketPickupArmor,
          adrenalineCostPaid: params.resolvePaidAdrenalineCost?.() ?? 0,
          safetyLifetimeMs: hasExtendedMiniRocketFlight ? (config.miniRocketSafetyLifetimeMs ?? 12_000) : undefined,
          cascadeDamageBonusPerExplosion: config.miniRocketCascadeDamageBonusPerExplosion,
        } : undefined,
      },
      provenance: createSingleOwnerProvenance(ownerId, {
        weaponSourceId: config.id,
        sourceSlot,
        sourceTurretId: options?.sourceTurretId,
        correlation: { ak47ShotId: config.ak47ShotId },
      }),
      interaction: {
        directHit: {
          damage:        config.directDamageOverride ?? config.damage,
          adrenalinGain: config.adrenalinGain,
          rockDamageMult:  config.rockDamageMult,
          trainDamageMult: config.trainDamageMult,
          baseDamageMult:  config.baseDamageMult ?? 1,
          slowFraction:       config.hitSlowFraction,
          slowDurationMs:     config.hitSlowDurationMs,
          knockback:          config.hitKnockback,
          knockbackDurationMs: config.hitKnockbackDurationMs,
          shotgun: isShotgun ? {
            originX: x,
            originY: y,
            resolvedRange: effectiveRange,
            proximityMaxDamageBonus: config.shotgunProximityMaxDamageBonus,
            slowFraction:   config.shotgunSlowFraction,
            slowDurationMs: config.shotgunSlowDurationMs,
          } : undefined,
          plasmaSwarm: plasmaSwarmEnabled ? {
            projectileCount:      config.plasmaSwarmProjectileCount,
            explosionRadius:      config.plasmaSwarmExplosionRadius,
            explosionDamage:      config.plasmaSwarmExplosionDamage,
            explosionSlowFraction: config.plasmaSwarmExplosionSlowFraction,
          } : undefined,
          ak47: {
            damageMultiplier:    config.ak47DamageMultiplier,
            fireSuperiorityShot: config.ak47FireSuperiorityShot,
          },
        },
        explosion:         fireConfig.impactExplosion,
        enemyHitExplosion: fireConfig.enemyHitExplosion,
        multiExplosion: {
          count:   config.multiExplosionCount,
          coastMs: isMiniRocket ? config.multiExplosionCoastMs : undefined,
        },
        impactCloud: fireConfig.impactCloud,
        // Brennende Kugeln (z.B. Glock/Negev-Upgrade): Burn-Felder aufs Projektil übertragen.
        burn: {
          durationMs:    config.burnOnHit?.durationMs,
          damagePerTick: config.burnOnHit?.damagePerTick,
          visualStyle:   config.projectileBurnVisualStyle,
          canReceiveFireImbue: sourceSlot === 'weapon1' || sourceSlot === 'weapon2',
        },
        pathEffect: isAwp ? {
          kind: 'awp',
          fireTrail: (config.awpCharge?.fireTrailDurationMs ?? 0) > 0 ? {
            durationMs: config.awpCharge?.fireTrailDurationMs ?? 0,
            burnDurationMs: config.awpCharge?.fireTrailBurnDurationMs ?? 0,
            burnDamagePerTick: config.awpCharge?.fireTrailBurnDamagePerTick ?? 0,
            sourceId: 'weapon.AWP.fire_trail',
            baseDamageMult: config.baseDamageMult ?? 1,
          } : undefined,
          fireTrailHalfWidthCells: config.awpCharge?.fireTrailHalfWidthCells,
          awpCorridor: hasAwpCorridor ? {
            halfWidth:          config.awpCharge?.corridorHalfWidth,
            damage:             config.awpCharge?.corridorDamage,
            dotDurationMs:      config.awpCharge?.corridorDotDurationMs,
            dotTickIntervalMs:  config.awpCharge?.corridorDotTickIntervalMs,
            knockback:          config.awpCharge?.corridorKnockback,
            knockbackDurationMs: config.awpCharge?.corridorKnockbackDurationMs,
          } : undefined,
        } : undefined,
        detonable:      config.detonable,
        detonator:      config.detonator,
        proximityPulse: config.proximityPulse,
      },
      presentation: {
        color:      config.projectileColor ?? ownerColor,  // Waffen-eigene Farbe hat Vorrang
        style:      config.projectileStyle,
        ownerColor,
        visualScale: config.projectileVisualScale,
        bulletPreset:  config.bulletVisualPreset,
        grenadePreset: config.grenadeVisualPreset,
        energyBallVariant: config.energyBallVariant,
        sporeVariant: config.projectileStyle === 'spore'
          ? fireConfig.impactCloud?.visualVariant === 'spore_void' ? 'spore_void' : 'spore'
          : undefined,
        smokeTrailColor: config.rocketSmokeTrailColor ?? ownerColor,
        tracer: config.tracerConfig,
        shotAudioKey: config.shotAudio?.successKey,
        visualMuzzleOrigin,
      },
    });

    return spawnResult !== null;
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
