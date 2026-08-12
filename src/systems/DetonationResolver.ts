import type { DamageOverTimeAreaConfig, ExplosionVisualStyle, RadialDamageFalloffConfig } from '../types';
import type { DetonationEvent } from './DetonationSystem';

/**
 * Wirkungen, die eine ausgelöste Detonation nach sich zieht.
 *
 * Das Gameplay füllt diese Grenze mit `CombatSystem`, `HostPhysicsSystem`, dem replizierten
 * Explosionskanal und dem Ressourcensystem; die lokale Lobby-Inszenierung mit ihren lokalen
 * Entsprechungen. Der Ablauf selbst – Reihenfolge, Verrechnung der optionalen Felder,
 * Farbwahl – liegt ausschließlich im Resolver, damit es keine zweite, lobbyeigene
 * Detonationsverarbeitung gibt.
 */
export interface DetonationEffectSink {
  /** Adrenalin für den Besitzer des gezündeten Projektils. Ohne Ressourcensystem ein No-op. */
  addComboAdrenaline(ownerId: string, amount: number): void;
  /** Flächenschaden an Figuren und Gegnern. */
  applyAoeDamage(
    x: number, y: number, radius: number, damage: number,
    attackerId: string,
    falloff: RadialDamageFalloffConfig | undefined,
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
  ): void;
  /** Optionale Schaden-über-Zeit-Fläche am Detonationsort. */
  spawnDotArea(
    dot: DamageOverTimeAreaConfig | undefined,
    x: number, y: number, explosionRadius: number,
    ownerId: string, ownerColor: number,
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
    sink.addComboAdrenaline(event.projectileOwnerId, comboAdrenalineGain);
  }

  sink.applyAoeDamage(
    event.x, event.y, effect.aoeRadius, effect.aoeDamage,
    event.detonatorOwnerId,
    effect.damageFalloff,
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

  const detonatorColor = sink.resolveOwnerColor(event.detonatorOwnerId);
  sink.playExplosion(
    event.x, event.y, effect.aoeRadius,
    effect.explosionColor ?? detonatorColor,
    effect.explosionVisualStyle,
  );

  sink.spawnDotArea(
    effect.dotArea, event.x, event.y, effect.aoeRadius,
    event.detonatorOwnerId, detonatorColor ?? 0xffffff,
  );
}

/** Verarbeitet einen ganzen Frame-Schwung in Reihenfolge. */
export function resolveDetonations(
  sink: DetonationEffectSink,
  events: readonly DetonationEvent[],
): void {
  for (const event of events) resolveDetonation(sink, event);
}
