import type { DamageOverTimeAreaConfig, ExplosionVisualStyle, LoadoutSlot, RadialDamageFalloffConfig } from '../types';
import type { DetonationEvent } from './DetonationSystem';
import type { ProjectileProximityPulseSource } from '../projectile/ProjectileGameplayPort';

/**
 * Wirkungen, die eine ausgelöste Detonation nach sich zieht.
 *
 * Das Gameplay füllt diese Grenze mit `WorldCombatCore`, `HostPhysicsSystem`, dem replizierten
 * Explosionskanal und dem Ressourcensystem; der Ablauf selbst – Reihenfolge, Verrechnung der
 * optionalen Felder und Farbwahl – liegt ausschließlich im Resolver, damit es keinen zweiten
 * Detonationspfad mit abweichender Reihenfolge gibt.
 */
export interface DetonationEffectSink {
  /** Confirmed combo reward; resources are only credited when its essence arrives. */
  spawnComboEssence(event: DetonationEvent, amount: number): void;
  /** One final pulse, using the ball's resolved stats and the detonator's attribution. */
  applyComboLightning(source: ProjectileProximityPulseSource, detonatorOwnerId: string): void;
  /** Flächenschaden an Figuren und Gegnern. */
  applyAoeDamage(
    x: number, y: number, radius: number, damage: number,
    attackerId: string,
    falloff: RadialDamageFalloffConfig | undefined,
    baseDamageMult: number,
    sourceSlot: LoadoutSlot | undefined,
  ): void;
  /** Radialer Rückstoß auf bewegliche Körper. */
  applyRadialImpulse(
    x: number, y: number, radius: number, force: number,
    attackerId: string, selfMultiplier: number,
  ): void;
  /** Umgebungsschaden auf Felsen und – sofern vorhanden – den Zug. */
  applyEnvironmentDamage(
    x: number, y: number, radius: number, damage: number,
    rockDamageMult: number, trainDamageMult: number,
    attackerId: string,
    falloff: RadialDamageFalloffConfig | undefined,
  ): void;
  /**
   * Explosionsdarstellung. Im Gameplay repliziert, in der Lobby rein lokal.
   * `color` bleibt bewusst optional: ohne Waffen- und Besitzerfarbe entscheidet die
   * Darstellungsseite selbst, nicht der Resolver.
   */
  playExplosion(
    x: number, y: number, radius: number, color: number | undefined,
    visualStyle: ExplosionVisualStyle | undefined,
    sourceId: string,
  ): void;
  /** Optionale Schaden-über-Zeit-Fläche am Detonationsort. */
  spawnDotArea(
    dot: DamageOverTimeAreaConfig | undefined,
    x: number, y: number, explosionRadius: number,
    ownerId: string, ownerColor: number,
    sourceId: string, sourceSlot: LoadoutSlot | undefined,
  ): void;
  /** Farbe des Detonator-Besitzers; `undefined`, wenn unbekannt. */
  resolveOwnerColor(ownerId: string): number | undefined;
}

/**
 * Nachgelagerte Verarbeitung einer einzelnen Detonation.
 *
 * Die ASMD-Signature-Kombination der Lobby benutzt genau diesen Weg: `DetonationSystem`
 * erkennt den Treffer auf den Ball, dieser Resolver setzt die Wirkung um. Es gibt keine
 * lobbyeigene ASMD-Explosion.
 */
export function resolveDetonation(sink: DetonationEffectSink, event: DetonationEvent): void {
  const { effect } = event;

  const comboAdrenalineGain = Math.max(0, effect.comboAdrenalineGain ?? 0);
  if (comboAdrenalineGain > 0) {
    sink.spawnComboEssence(event, comboAdrenalineGain);
  }

  sink.applyAoeDamage(
    event.x, event.y, effect.aoeRadius, effect.aoeDamage,
    event.detonatorOwnerId,
    effect.damageFalloff,
    effect.baseDamageMult ?? 1,
    event.sourceSlot,
  );

  if ((effect.knockback ?? 0) > 0) {
    sink.applyRadialImpulse(
      event.x, event.y, effect.aoeRadius,
      effect.knockback ?? 0, event.detonatorOwnerId,
      effect.selfKnockbackMult ?? 1,
    );
  }

  sink.applyEnvironmentDamage(
    event.x, event.y, effect.aoeRadius, effect.aoeDamage,
    effect.rockDamageMult ?? 1, effect.trainDamageMult ?? 1,
    event.detonatorOwnerId,
    effect.damageFalloff,
  );

  const pulse = resolveComboLightning(event);
  if (pulse) sink.applyComboLightning(pulse, event.detonatorOwnerId);

  const detonatorColor = sink.resolveOwnerColor(event.detonatorOwnerId);
  sink.playExplosion(
    event.x, event.y, effect.aoeRadius,
    effect.explosionColor ?? detonatorColor,
    effect.explosionVisualStyle,
    event.sourceId,
  );

  sink.spawnDotArea(
    effect.dotArea, event.x, event.y, effect.aoeRadius,
    event.detonatorOwnerId, detonatorColor ?? 0xffffff,
    event.sourceId, event.sourceSlot,
  );
}

export const COMBO_LIGHTNING_RANGE_MULTIPLIER = 2;

export function getComboLightningDamageMultiplier(level: number): number {
  return level > 0 ? level + 1 : 0;
}

/** Upgrade multipliers apply after all modifiers already captured by the ball. */
export function resolveComboLightning(event: DetonationEvent): ProjectileProximityPulseSource | null {
  const level = event.effect.comboLightningLevel ?? 0;
  const source = event.pulseSource;
  const pulse = source?.proximityPulse;
  if (level <= 0 || !source || !pulse || pulse.radius <= 0 || pulse.damage <= 0) return null;
  const multiplier = getComboLightningDamageMultiplier(level);
  return {
    ...source, x: event.x, y: event.y,
    proximityPulse: { ...pulse, radius: pulse.radius * COMBO_LIGHTNING_RANGE_MULTIPLIER, damage: pulse.damage * multiplier },
  };
}

/** Verarbeitet einen ganzen Frame-Schwung in Reihenfolge. */
export function resolveDetonations(
  sink: DetonationEffectSink,
  events: readonly DetonationEvent[],
): void {
  for (const event of events) resolveDetonation(sink, event);
}
