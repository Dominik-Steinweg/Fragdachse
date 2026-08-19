import { getWeaponConfig } from '../../loadout/LoadoutConfig';
import { GenericWeapon } from '../../loadout/GenericWeapon';
import { WeaponFireExecutor } from '../../loadout/WeaponFireExecutor';
import { HeadlessSingleTargetWorld } from './HeadlessSingleTargetWorld';
import type {
  SingleTargetBenchmarkOptions,
  SingleTargetBenchmarkResult,
} from './weaponBenchmarkTypes';

/**
 * Ermittelt eine sinnvolle Standarddistanz zum Ziel passend zur Reichweite und zum Typ der Waffe.
 */
export function resolveDefaultTargetDistance(fireType: string, range: number): number {
  if (fireType === 'melee') {
    // Nahkampf: Ziel so platzieren, dass es sicher innerhalb der Reichweite liegt
    return Math.min(40, Math.max(10, range * 0.8));
  }
  // Fernkampf (Hitscan / Projektil): Standard-Prüfdistanz von 150px
  return Math.min(150, Math.max(40, range * 0.5));
}

/**
 * Führt einen deterministischen Headless-Single-Target-Benchmark für die angegebene Waffe aus.
 *
 * Simuliert das Feuern mit maximal zulässiger Kadenz über die gewünschte virtuelle Zeitdauer,
 * misst den tatsächlich verursachten Schaden und erfasste Ressourcen (Adrenalin),
 * ohne Rendering, Audio, Netzwerk oder Echtzeit-Kopplung.
 *
 * @param options Konfigurationsparameter des Benchmark-Laufs
 * @returns Strukturiertes Messergebnis inklusive DPS, Trefferquote und Event-Historie
 */
export function runWeaponSingleTargetBenchmark(
  options: SingleTargetBenchmarkOptions,
): SingleTargetBenchmarkResult {
  const config = options.weaponConfigOverride ?? getWeaponConfig(options.weaponId);
  if (!config) {
    throw new Error(`[WeaponBalanceLab] Unbekannte Weapon-ID: "${options.weaponId}"`);
  }

  const durationMs = options.durationMs ?? 30_000;
  const stepDeltaMs = options.stepDeltaMs ?? 16;
  const seed = options.seed ?? 1;
  const slot = options.sourceSlot ?? config.allowedSlots[0] ?? 'weapon1';

  const targetDistance = options.targetDistance ?? resolveDefaultTargetDistance(config.fire.type, config.range);
  const world = new HeadlessSingleTargetWorld(targetDistance, seed);
  const weapon = new GenericWeapon(config);
  const executor = new WeaponFireExecutor(world);

  const shooterId = 'sim_player';
  const playerColor = 0xffffff;
  const shooterX = 0;
  const shooterY = 0;
  const targetX = world.target.x;
  const targetY = world.target.y;
  const targetAngle = Math.atan2(targetY - shooterY, targetX - shooterX);

  for (let now = 0; now < durationMs; now += stepDeltaMs) {
    world.setTime(now);

    // Prüfen, ob die Waffe zu diesem Zeitpunkt feuerbereit ist (Cooldown)
    if (!weapon.isOnCooldown(now)) {
      // Authentische Spread-Berechnung (Basis-Spread im Stehen + dynamischer Bloom)
      const dynamicSpread = weapon.getDynamicSpread();
      const totalSpreadDeg = Math.max(0, config.spreadStanding + dynamicSpread);
      const halfSpreadRad = (totalSpreadDeg * Math.PI / 180) / 2;
      const spreadRoll = (world.rng() * 2 - 1) * halfSpreadRad;
      const shotAngle = targetAngle + spreadRoll;

      world.recordShotFired();

      // Ressourcenverbrauch (Adrenalin) erfassen
      if (config.adrenalinCost > 0) {
        world.recordAdrenalineDrain(config.adrenalinCost, config.id);
      }

      // Schuss über den gemeinsamen WeaponFireExecutor absetzen
      executor.fire(config, {
        x: shooterX,
        y: shooterY,
        angle: shotAngle,
        targetX,
        targetY,
        ownerId: shooterId,
        ownerColor: playerColor,
        sourceSlot: slot,
      });

      // Cooldown und dynamischen Bloom aktualisieren
      weapon.addSpread();
      weapon.recordUse(now);
    }

    // Dynamischen Bloom über die Zeit abbauen
    weapon.decaySpread(stepDeltaMs, now);

    // Aktive Projektile im Flug weiterbewegen und Treffer auswerten
    world.step(stepDeltaMs);
  }

  const totalDamage = world.getTotalDamage();
  const shotsFired = world.getShotsFired();
  const hits = world.getHits();
  const hitRate = shotsFired > 0 ? hits / shotsFired : 0;
  const durationSec = durationMs / 1000;
  const dps = durationSec > 0 ? totalDamage / durationSec : 0;
  const adrenalineGenerated = world.getAdrenalineGenerated();
  const adrenalineSpent = world.getAdrenalineSpent();
  const adrenalineGeneratedPerSec = durationSec > 0 ? adrenalineGenerated / durationSec : 0;
  const adrenalineSpentPerSec = durationSec > 0 ? adrenalineSpent / durationSec : 0;

  return {
    weaponId: config.id,
    durationMs,
    totalDamage,
    dps,
    shotsFired,
    hits,
    hitRate,
    adrenalineGenerated,
    adrenalineSpent,
    adrenalineGeneratedPerSec,
    adrenalineSpentPerSec,
    damageEvents: world.getDamageEvents(),
    resourceEvents: world.getResourceEvents(),
  };
}
