import type { WeaponConfig } from '../../loadout/LoadoutConfig';

export interface WeaponBalanceCapabilityCheck {
  readonly supported: boolean;
  readonly unsupportedReasons: readonly string[];
}

export class UnsupportedWeaponMechanicError extends Error {
  readonly weaponId: string;
  readonly unsupportedReasons: readonly string[];

  constructor(weaponId: string, unsupportedReasons: readonly string[]) {
    super(
      `[WeaponBalanceLab] Waffe "${weaponId}" verwendet noch nicht unterstützte Mechaniken für Headless-Single-Target: ${unsupportedReasons.join(', ')}`,
    );
    this.name = 'UnsupportedWeaponMechanicError';
    this.weaponId = weaponId;
    this.unsupportedReasons = unsupportedReasons;
  }
}

/**
 * Validiert, ob eine WeaponConfig für den Headless-Single-Target-Benchmark unterstützt wird.
 *
 * Systematische Einteilung aller Felder von `WeaponConfigShape`:
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KATEGORIE A: Bereits korrekt im Headless Single-Target unterstützt
 * - `id`, `cooldown`, `damage`, `range`
 * - `fire.type`: 'projectile', 'hitscan', 'melee'
 * - `fire.projectileSpeed`, `fire.projectileSize`, `fire.projectileMaxBounces`
 * - `fire.traceThickness`, `fire.tracerColor`
 * - `fire.arcDegrees`
 * - `allowedSlots`, `allowedModes`
 * - `adrenalinCost`, `adrenalinGain`
 * - `spreadStanding`, `spreadMoving` (isMoving=false im Stand), `spreadPerShot`, `maxDynamicSpread`
 * - `spreadRecoveryDelay`, `spreadRecoveryRate`, `spreadRecoverySpeed`
 * - `warmupSpeedMultiplier`
 * - `pelletCount`, `pelletSpreadAngle`, `pelletCountMultiplier`
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KATEGORIE B: Im Single-Target Dummy-Szenario bewusst irrelevant (ohne Einfluss auf DPS/Ressourcen)
 * - Visuals / Audio / UI: `projectileColor`, `projectileStyle`, `projectileVisualScale`,
 *   `bulletVisualPreset`, `grenadeVisualPreset`, `energyBallVariant`, `projectileBurnVisualStyle`,
 *   `rocketSmokeTrailColor`, `tracerConfig`, `showCrosshair`, `shotAudio`, `shotScreenShake`
 * - Spieler-Rückstoß / Bewegungsbremse: `holdSpeedFactor`, `shotRecoilForce`, `shotRecoilDuration`
 *   (Schütze steht im Benchmark still)
 * - Dummy-Rückstoß: `hitKnockback`, `hitKnockbackDurationMs` (Dummy bleibt fest auf Messposition)
 * - Spieler-Defensive: `damageReduction` (Dummy greift nicht an)
 * - Objekt-/Umgebungs-Multiplikatoren: `rockDamageMult`, `trainDamageMult`, `baseDamageMult`
 *   (Dummy ist ein einzelnes spielergroßes Dachs-Ziel)
 * - Turret-Burst: `turretBurst` (normale Spielerwaffen ignorieren ihn laut Schema)
 * - Kosmetik: `bloodEffectMultiplier`
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KATEGORIE C: Ergebnisrelevant für Single-Target, aber noch unsupported (BLOCKIERT)
 * - Treffer-Ressourcen: `hitAdrenaline`, `hitHeal`
 * - Debuffs & Schadensverstärkung: `hitVulnerabilityDurationMs`, `hitDebuffChance`, `hitSlow*`, `shotgunSlow*`
 * - Scopes & Aim: `scopeConfig`, `awpCharge`
 * - Schaden-Overrides: `directDamageOverride`
 * - Brand & Status: `burnOnHit`, `warmupBurnThreshold`
 * - Flächenschaden & Explosionen: `impactExplosion`, `enemyHitExplosion`, `multiExplosionCount`
 * - Zielsuchung & Spaltung: `homing`, `homingEnabled`, `splitCount`, `splitHomingEnabled`
 * - Ketten & Durchschlag: `chainLightning`, `penetrationCount`, `penetratesRocks`
 * - Detonationen: `detonable`, `detonator`
 * - Spezifische Waffenmechaniken: `ak47Focus`, `negevKillstreak`, `plasmaSwarm*`, `sideBurst*`,
 *   `proximityPulse`, `shotgunLightning*`, `shotgunProximity*`, `shotgunChain*`, `miniRocket*`
 */
export function validateWeaponBalanceCapabilities(config: WeaponConfig): WeaponBalanceCapabilityCheck {
  const unsupportedReasons: string[] = [];

  const fireType = config.fire.type;
  if (fireType !== 'projectile' && fireType !== 'hitscan' && fireType !== 'melee') {
    unsupportedReasons.push(`Fire-Typ "${fireType}" ist noch nicht headless implementiert`);
  }

  // 1. Treffer-Ressourcen (Bite, etc.)
  if (config.hitAdrenaline !== undefined && config.hitAdrenaline > 0) {
    unsupportedReasons.push('hitAdrenaline (Treffer-Adrenalin) ist in Headless noch nicht implementiert');
  }
  if (config.hitHeal !== undefined && config.hitHeal > 0) {
    unsupportedReasons.push('hitHeal (Treffer-Heilung) ist in Headless noch nicht implementiert');
  }

  // 2. Debuffs & Schadensmodifikatoren auf Treffer
  if (config.hitVulnerabilityDurationMs !== undefined && config.hitVulnerabilityDurationMs > 0) {
    unsupportedReasons.push('hitVulnerabilityDurationMs (Verwundbarkeits-Debuff) ist noch nicht implementiert');
  }
  if (config.hitDebuffChance !== undefined && config.hitDebuffChance > 0) {
    if ((config.hitVulnerabilityDurationMs ?? 0) > 0 || (config.hitSlowDurationMs ?? 0) > 0) {
      unsupportedReasons.push('hitDebuffChance mit aktiven Debuffs ist noch nicht implementiert');
    }
  }
  if ((config.hitSlowDurationMs ?? 0) > 0 && (config.hitSlowFraction ?? 0) > 0) {
    unsupportedReasons.push('hitSlow (Gegner-Verlangsamung) ist noch nicht implementiert');
  }
  if ((config.shotgunSlowDurationMs ?? 0) > 0 && (config.shotgunSlowFraction ?? 0) > 0) {
    unsupportedReasons.push('shotgunSlow ist noch nicht implementiert');
  }
  if (config.directDamageOverride !== undefined) {
    unsupportedReasons.push('directDamageOverride ist noch nicht implementiert');
  }

  // 3. Scope & AWP-Charge
  if (config.scopeConfig !== undefined) {
    unsupportedReasons.push('scopeConfig (Scharfschützen-Scope) ist in Headless noch nicht implementiert');
  }
  if (config.awpCharge && ((config.awpCharge.maxDamageBonus ?? 0) > 0 || (config.awpCharge.corridorEnabled ?? 0) > 0)) {
    unsupportedReasons.push('awpCharge (Scope-Aufladung / Schneise) ist noch nicht implementiert');
  }

  // 4. Brand & Warmup-Burn
  if (config.burnOnHit && ((config.burnOnHit.damagePerTick ?? 0) > 0 || (config.burnOnHit.durationMs ?? 0) > 0)) {
    unsupportedReasons.push('burnOnHit (Brand-DoT) ist noch nicht headless implementiert');
  }
  if (config.warmupBurnThreshold !== undefined && config.warmupBurnThreshold > 0) {
    unsupportedReasons.push('warmupBurnThreshold (Brand-Aufwärmung) ist noch nicht implementiert');
  }

  // 5. Projektil-Sonderpayloads
  if (fireType === 'projectile') {
    const projFire = config.fire;
    if (projFire.impactExplosion && projFire.impactExplosion.maxDamage > 0 && projFire.impactExplosion.radius > 0) {
      unsupportedReasons.push('impactExplosion (Flächenschaden) ist noch nicht headless implementiert');
    }
    if (projFire.enemyHitExplosion && projFire.enemyHitExplosion.maxDamage > 0 && projFire.enemyHitExplosion.radius > 0) {
      unsupportedReasons.push('enemyHitExplosion ist noch nicht headless implementiert');
    }
    if (projFire.homing && (config.homingEnabled === undefined || config.homingEnabled > 0)) {
      unsupportedReasons.push('Homing (Zielverfolgung) ist noch nicht headless implementiert');
    }
  }

  // 6. Spaltung & Kettenblitze
  if (config.splitCount !== undefined && config.splitCount > 0) {
    unsupportedReasons.push('Hydra-Splitting (splitCount) ist noch nicht headless implementiert');
  }
  if (config.chainLightning && config.chainLightning.maxJumps > 0) {
    unsupportedReasons.push('chainLightning (Kettenblitze) ist noch nicht headless implementiert');
  }

  // 7. Durchschlag & Detonationen
  if (config.penetrationCount !== undefined && config.penetrationCount > 0) {
    unsupportedReasons.push('penetrationCount (Durchschlag) ist noch nicht headless implementiert');
  }
  if (config.detonable) {
    unsupportedReasons.push('detonable (ASMD-Ball-Detonation) ist noch nicht headless implementiert');
  }
  if (config.proximityPulse && config.proximityPulse.damage > 0) {
    unsupportedReasons.push('proximityPulse ist noch nicht headless implementiert');
  }

  // 8. Spezifische Waffenmechaniken
  if (config.sideBurstEveryShots !== undefined && config.sideBurstEveryShots > 0 && (config.sideBurstCount ?? 0) >= 2) {
    unsupportedReasons.push('sideBurst (zusätzliche Seitenschüsse) ist noch nicht headless implementiert');
  }
  if (config.plasmaSwarmEnabled !== undefined && config.plasmaSwarmEnabled > 0) {
    unsupportedReasons.push('plasmaSwarm (Funken-Schwarm) ist noch nicht headless implementiert');
  }
  if (config.ak47Focus && ((config.ak47Focus.maxStacks ?? 0) > 0 || (config.ak47Focus.fireSuperiorityShots ?? 0) > 0)) {
    unsupportedReasons.push('ak47Focus (Fokus-Stacks / Überlegenheit) ist noch nicht headless implementiert');
  }
  if (config.negevKillstreak && (config.negevKillstreak.damageBonusPerKill ?? 0) > 0) {
    unsupportedReasons.push('negevKillstreak (Killstreak-Schaden) ist noch nicht headless implementiert');
  }
  if (config.shotgunLightningDamage !== undefined && config.shotgunLightningDamage > 0) {
    unsupportedReasons.push('shotgunLightning (Kugelblitz) ist noch nicht headless implementiert');
  }
  if (config.shotgunProximityMaxDamageBonus !== undefined && config.shotgunProximityMaxDamageBonus > 0) {
    unsupportedReasons.push('shotgunProximity (Distanzschadensbonus) ist noch nicht headless implementiert');
  }
  if (config.shotgunChainEnabled !== undefined && config.shotgunChainEnabled > 0) {
    unsupportedReasons.push('shotgunChain ist noch nicht headless implementiert');
  }
  if (config.miniRocketCascadeDamageBonusPerExplosion !== undefined && config.miniRocketCascadeDamageBonusPerExplosion > 0) {
    unsupportedReasons.push('miniRocketCascade (Kaskaden-Bonus) ist noch nicht headless implementiert');
  }
  if (config.miniRocketReturnEnabled !== undefined && config.miniRocketReturnEnabled > 0) {
    unsupportedReasons.push('miniRocketReturn (Rückkehr) ist noch nicht headless implementiert');
  }
  if (config.multiExplosionCount !== undefined && config.multiExplosionCount > 1) {
    unsupportedReasons.push('multiExplosionCount (Mehrfachexplosionen) ist noch nicht headless implementiert');
  }

  return {
    supported: unsupportedReasons.length === 0,
    unsupportedReasons,
  };
}

/**
 * Wirft einen expliziten Fehler, falls die Waffe noch nicht unterstützte Mechaniken enthält.
 */
export function assertWeaponBalanceSupported(config: WeaponConfig): void {
  const check = validateWeaponBalanceCapabilities(config);
  if (!check.supported) {
    throw new UnsupportedWeaponMechanicError(config.id, check.unsupportedReasons);
  }
}
