import type { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { TurretAimConfig } from '../config/turretAim';

export type AutomatedTurretId = number | string;
export type AutomatedTurretTargetMode = 'players' | 'enemies';
export interface AutomatedTurret extends TurretAimConfig {
  /** Occupant exit contour; retained through removal of the turret or its carrier. */
  readonly footprint?: { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };
  readonly angle?: number;
  readonly id: AutomatedTurretId;
  readonly x: number;
  readonly y: number;
  readonly ownerId: string;
  readonly ownerColor: number;
  readonly weaponId?: keyof typeof WEAPON_CONFIGS;
  readonly skipRockIndex?: number;
  /** Nur der konkrete Träger ist bis zum ersten vollständigen Austritt freigegeben. */
  readonly sourceCarrierBaseId?: string;
  readonly secondProjectileDamageFactor?: number;
  /** Beim Platzieren eingefrorene Zielreichweite; fehlt bei Basis-Turrets (dann gilt die Config). */
  readonly targetRange?: number;
  readonly projectileRange?: number;
  readonly cooldownMs?: number;
  readonly damage?: number;
  readonly muzzleOffset?: number;
  /** Erzwingt die Laufzeit-Zielfraktion; ohne Wert bleibt das bisherige gemischte Verhalten. */
  readonly targetMode?: AutomatedTurretTargetMode;
}
export type TurretFireState = 'active' | 'paused';
/**
 * Eintrag des Turmfeuers. Eine Konstruktion ist ohne Feuerleitung genau eine Quelle, deren
 * Identitäts-, Folge- und Darstellungsschlüssel ihre eigene ID sind. Temporäre Quellen (Turmkopien)
 * tragen eine eigene `id`, verweisen aber über `identityId` auf ihr Original.
 */
export interface TurretFireSource extends AutomatedTurret {
  /** Konstruktion, der identitätsgebundene Effekte, Bemannung und Attribution gehören. */
  readonly identityId: AutomatedTurretId;
  /** Owner von Cooldown und laufender Salve; Einträge mit gleichem Schlüssel teilen ihre Feuerfolge. */
  readonly sequenceKey: AutomatedTurretId;
  /** Startzustand einer noch unbekannten eigenen Folge (`nextFireAt` dieses Schlüssels). */
  readonly sequenceSeedKey?: AutomatedTurretId;
  /** Pausierte Quellen beginnen nichts Neues, halten aber ihre Feuerfolge am Leben. */
  readonly fireState: TurretFireState;
  /** Sprite, das Schussanimation und Rohrdrehung dieses Eintrags darstellt. */
  readonly visualId: AutomatedTurretId;
}
/** Zusatzwissen eines Schusses, das nicht in die positionalen Fire-Handler-Argumente gehört. */
export interface TurretFireContext {
  readonly source: TurretFireSource;
}
export function toLocalTurretFireSource(turret: AutomatedTurret): TurretFireSource {
  return { ...turret, identityId: turret.id, sequenceKey: turret.id, visualId: turret.id, fireState: 'active' };
}
