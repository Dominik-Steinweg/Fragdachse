import { ALLIED_COLOR, ALLIED_PALETTE, VOID_PALETTE } from '../config';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import type { DamageZoneVisualStyle, GroundFireDamageTarget, GroundFireVisualStyle, ProjectileExplosionConfig } from '../types';

/**
 * Einziger Ort für die optische Umdeutung verbündeter Gegner (Nekromantie, Übernahme).
 *
 * Verbündete benutzen dieselben Waffen und Fähigkeiten wie ihre feindliche Gattung. Lila Void-
 * oder rote Gegnereffekte würden sie dann als Feinde lesen lassen; hier werden sie deshalb in
 * die gemeinsame Verbündeten-Palette (`ALLIED_PALETTE`) übersetzt. Der Host entscheidet das
 * beim Erzeugen; Farben und Stile replizieren danach über die vorhandenen Wire-Felder.
 */

type EnemyFaction = 'hostile' | 'allied';

/** Waffen-Override für Verbündete: Projektil-, Tracer-, Rauch-, Explosions- und Brandfarben. */
export function resolveAlliedEnemyWeaponConfig(config: WeaponConfig): WeaponConfig {
  const fire = config.fire;
  const alliedFire = fire.type === 'projectile' && (fire.impactExplosion || fire.impactCloud)
    ? {
      ...fire,
      impactExplosion: fire.impactExplosion
        ? { ...fire.impactExplosion, color: fire.impactExplosion.color === undefined ? undefined : ALLIED_COLOR }
        : undefined,
      impactCloud: fire.impactCloud
        ? { ...fire.impactCloud, visualVariant: alliedDamageZoneVariant(fire.impactCloud.visualVariant) }
        : undefined,
    }
    : fire;
  return {
    ...config,
    fire: alliedFire,
    projectileColor: config.projectileColor === undefined ? undefined : ALLIED_COLOR,
    tracerConfig: config.tracerConfig?.color === undefined
      ? config.tracerConfig
      : { ...config.tracerConfig, color: ALLIED_PALETTE.deep },
    rocketSmokeTrailColor: config.rocketSmokeTrailColor === undefined ? undefined : ALLIED_PALETTE.bright,
    projectileBurnVisualStyle: config.projectileBurnVisualStyle === undefined
      ? undefined
      : alliedFireStyle(config.projectileBurnVisualStyle),
  } as WeaponConfig;
}

interface EnemyFireEffectFields {
  readonly visualStyle?: GroundFireVisualStyle;
  readonly damageTarget?: GroundFireDamageTarget;
}

type ResolvedEnemyFireEffect<T> = Omit<T, keyof EnemyFireEffectFields> & {
  readonly visualStyle?: GroundFireVisualStyle;
  readonly damageTarget?: GroundFireDamageTarget;
};

/**
 * Brandflächen verbündeter Gegner: grüne Familie und Schaden nur gegen feindliche Gegner.
 * Gegnerisches Feuer trifft Spieler; dieselbe Fläche eines Verbündeten darf das nie – auch
 * nicht, wenn der Verbündete gestorben ist, bevor sie erlischt.
 */
export function resolveEnemyFireEffect<T extends EnemyFireEffectFields>(
  faction: EnemyFaction,
  effect: T,
): ResolvedEnemyFireEffect<T> {
  return { ...effect, visualStyle: faction === 'allied' ? 'allied' : 'void',
    damageTarget: faction === 'allied' ? 'enemies' : 'players' };
}

/** Resolve enemy fire at creation so its faction survives the actor's death. */
export function resolveEnemyWeaponFirePayloads(config: WeaponConfig, faction: EnemyFaction): WeaponConfig {
  const color = faction === 'allied' ? ALLIED_COLOR : VOID_PALETTE.primary;
  const explosion = (effect: ProjectileExplosionConfig | undefined): ProjectileExplosionConfig | undefined => effect ? {
    ...effect, color, damageTarget: faction === 'allied' ? 'enemies' : 'players',
    burnOnHit: effect.burnOnHit ? { ...effect.burnOnHit, visualStyle: faction === 'allied' ? 'allied' : 'void' } : undefined,
    groundFire: effect.groundFire ? resolveEnemyFireEffect(faction, effect.groundFire) : undefined,
    fireChunkBurst: effect.fireChunkBurst ? resolveEnemyFireEffect(faction, effect.fireChunkBurst) : undefined,
  } : undefined;
  return {
    ...config, projectileColor: color, projectileBurnVisualStyle: faction === 'allied' ? 'allied' : 'void',
    burnOnHit: config.burnOnHit ? { ...config.burnOnHit, visualStyle: faction === 'allied' ? 'allied' : 'void' } : undefined,
    fire: config.fire.type === 'projectile' ? { ...config.fire,
      impactExplosion: explosion(config.fire.impactExplosion), enemyHitExplosion: explosion(config.fire.enemyHitExplosion),
    } : config.fire,
    detonable: config.detonable ? { ...config.detonable, explosionColor: color,
      explosion: explosion(config.detonable.explosion),
    } : undefined,
  };
}

/** Lila Sporen verbündeter Gegner nutzen die grüne Sporenfamilie. */
export function alliedDamageZoneVariant<T extends DamageZoneVisualStyle | undefined>(variant: T): T {
  return (variant === 'spore_void' ? 'spore' : variant) as T;
}

function alliedFireStyle(style: GroundFireVisualStyle): GroundFireVisualStyle {
  return style === 'normal' ? 'normal' : 'allied';
}
