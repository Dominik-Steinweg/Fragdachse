import type { WEAPON_CONFIGS } from '../loadout/LoadoutConfig';
import type { TurretAimConfig } from '../config/turretAim';
import type { EnergyInjectorConstructionEffect } from '../types';

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
/** `paused` begins nothing new but finishes its own burst; `disabled` (webbed) ends it and neither aims nor fires. */
export type TurretFireState = 'active' | 'paused' | 'disabled';
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
  /** Pausierte Quellen beginnen nichts Neues, halten aber ihre Feuerfolge am Leben; deaktivierte ruhen ganz. */
  readonly fireState: TurretFireState;
  /** Sprite, das Schussanimation und Rohrdrehung dieses Eintrags darstellt. */
  readonly visualId: AutomatedTurretId;
  /**
   * Je Tick abgeleitete Teilnahme an einem Portaleinsatz des Besitzers (GDD V2 §4.2). Fehlt für
   * nicht berechtigte Quellen (pausiert, bemannt, Kopie noch nicht materialisiert).
   */
  readonly portal?: TurretPortalAssignment;
  /**
   * Nur Holo-Kopien der Ultimate „Holo-Offensive“ (GDD Ultimates V2 §2). Eine Projektion ist eine
   * eigenständige Quelle (`id === identityId === sequenceKey === visualId`), aber nie eine
   * Konstruktion: nicht bemannbar, nicht fernsteuerbar, kein Injektor-Lookup über ihre Position,
   * nie über Portale. Identitätsgebundene Fakten des Originals sind beim Spawn eingefroren.
   */
  readonly projection?: TurretProjection;
}
/** Beim Spawn eingefrorene Fakten einer Holo-Kopie. */
export interface TurretProjection {
  readonly deploymentId: number;
  /** Konstruktions-ID der Vorlage zum Spawnzeitpunkt; nur Herkunft, keine Identitätswirkung. */
  readonly templateId: number;
  /** Vorlage war ein persönliches MG: die Kopie führt einen eigenen MG-Attrition-Stack. */
  readonly personalMg: boolean;
  /**
   * „Injektorprojektion“: Injektor-Effekt des Turmtyps für die gesamte Lebensdauer, sonst `null`.
   * Schadenstürme multiplizieren ihren Schuss, Gravitation und Verlangsamung tragen ihn über
   * `ProjectileProvenance.injectorEffect` bis zum (auch verzögerten) Treffer.
   */
  readonly injectorEffect: EnergyInjectorConstructionEffect | null;
}
/** Fakten des Portaleinsatzes, an dem eine Quelle teilnimmt; Eingang und Modus entstehen im TurretSystem. */
export interface TurretPortalAssignment {
  readonly deploymentId: number;
  readonly exitX: number;
  readonly exitY: number;
  readonly damageBonus: number;
  readonly localFireRelease: boolean;
  readonly expiresAt: number;
}
/** Bei der Schussabgabe fixierter Portalweg (D16/D35); fehlt bei lokalem Feuer. */
export interface TurretFireRoute {
  readonly deploymentId: number;
  readonly entry: { readonly x: number; readonly y: number };
  readonly exit: { readonly x: number; readonly y: number };
  readonly damageBonus: number;
  /**
   * Virtueller Distanzpunkt für cursorbegrenzte Waffen: Mündung + Richtung · (Präfix + Ausgang→Ziel).
   * Die Waffe misst ihre Reichweite sonst über die Sprungstrecke hinweg.
   */
  readonly rangeTargetX: number;
  readonly rangeTargetY: number;
}
/** Zusatzwissen eines Schusses, das nicht in die positionalen Fire-Handler-Argumente gehört. */
export interface TurretFireContext {
  readonly source: TurretFireSource;
  readonly route?: TurretFireRoute;
}
export function toLocalTurretFireSource(turret: AutomatedTurret): TurretFireSource {
  return { ...turret, identityId: turret.id, sequenceKey: turret.id, visualId: turret.id, fireState: 'active' };
}
