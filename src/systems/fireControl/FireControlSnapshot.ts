import type { AutomatedTurret, AutomatedTurretId } from '../TurretSystem';

/**
 * Replizierter Lesezustand der Feuerleit-Utilities (GDD V2). Der Host besitzt die Einsätze;
 * Clients, Late Join und Darstellung lesen ausschließlich diesen Snapshot. Er enthält nur
 * bestätigte Fakten und davon abgeleitete Quellenzustände, keine Konfiguration zum Rekonstruieren.
 *
 * Zeiten sind absolute Host-Zeiten in Millisekunden (`Date.now()` auf dem Host, auf Clients über
 * `NetworkBridge.getSynchronizedNow()` vergleichbar). Positionen sind Weltkoordinaten in Pixeln,
 * Winkel Radiant im Phaser-Koordinatensystem (0 = Osten, positiv im Uhrzeigersinn).
 */

/** `copies` = Turmkopien (GDD V1: Feuerleit-Relais), `portal` = Portale (GDD V1: Feuerleitgranate). */
export type FireControlDeploymentKind = 'copies' | 'portal';

/**
 * Lebensphase einer Turmkopie. Eine vorzeitig endende Kopie verschwindet aus dem Snapshot; ihr
 * Vergehen spielt die Darstellung beim Entfernen ab, es gibt deshalb keinen eigenen Endstatus.
 */
export type FireControlCopyStatus = 'materializing' | 'active';

/**
 * Feuerweg einer an einen Portaleinsatz angeschlossenen Quelle:
 * - `portal`: Ziel am Ausgang vorhanden, der Mündungseingang ist offen und transportiert.
 * - `waiting`: kein geeignetes Ziel am Ausgang; die Quelle schweigt (Grundversion).
 * - `local`: kein Ziel am Ausgang, die Quelle kämpft lokal (nur mit „Lokale Feuerfreigabe“);
 *   der Eingang wird deaktiviert dargestellt.
 */
export type FireControlEntryMode = 'portal' | 'waiting' | 'local';

/**
 * Laufzeit-ID einer Feuerquelle: Konstruktions-ID eines Originals (`number`) oder die Quell-ID
 * einer Turmkopie (`string`, siehe {@link fireControlCopySourceId}).
 */
export type FireControlSourceId = AutomatedTurretId;

/** Turmwaffe einer Quelle; identisch mit der Waffe des Originals. */
export type FireControlWeaponId = NonNullable<AutomatedTurret['weaponId']>;

export interface FireControlCopySnapshot {
  /** Laufzeit-ID der Kopie; nie eine Konstruktions-ID und nie in `getTurretDefinitions()`. */
  readonly sourceId: string;
  /** Konstruktions-ID des Originals. Träger aller identitätsgebundenen Effekte (MG, Injektor). */
  readonly originalId: number;
  /** Bau-Definition des Originals, z. B. `rocket_turret`; bestimmt Sprite und Animation. */
  readonly constructionId: string;
  readonly weaponId: FireControlWeaponId;
  readonly x: number;
  readonly y: number;
  /** Aktueller Rohrwinkel der Kopie. */
  readonly angle: number;
  readonly status: FireControlCopyStatus;
  /** Absoluter Zeitpunkt, ab dem die Kopie vollständig materialisiert ist und feuern darf. */
  readonly materializedAt: number;
  /**
   * `true`, solange das Original während der Projektion pausiert (Grundversion). Mit
   * Parallelbetrieb `false`: Original und Kopie kämpfen beide.
   */
  readonly originalPaused: boolean;
}

export interface FireControlEntrySnapshot {
  /** Angeschlossene Feuerquelle: Original oder Kopie. */
  readonly sourceId: FireControlSourceId;
  /** Konstruktions-ID des Originals, auch wenn die Quelle eine Kopie ist. */
  readonly identityId: number;
  readonly mode: FireControlEntryMode;
  /** Mittelpunkt des Mündungsportals; liegt vor dem Rohr und folgt dessen Drehung. */
  readonly x: number;
  readonly y: number;
  /** Ausrichtung des Eingangs = Rohrwinkel der Quelle. */
  readonly angle: number;
}

interface FireControlDeploymentSnapshotBase {
  /** Host-vergebene Einsatz-ID, eindeutig innerhalb der World-Lifetime. */
  readonly id: number;
  readonly ownerId: string;
  readonly ownerColor: number;
  /**
   * Turmkopien: Platzierungspunkt mit dem Relais-Projektor.
   * Portale: fester Ausgang; er wirkt rundum und hat keine feste Austrittsrichtung.
   */
  readonly x: number;
  readonly y: number;
  readonly startedAt: number;
  /** Absolutes Einsatzende; Cooldown und Aufräumen beginnen hier. */
  readonly expiresAt: number;
}

export interface FireControlCopiesDeploymentSnapshot extends FireControlDeploymentSnapshotBase {
  readonly kind: 'copies';
  /** Beim Einsatz eingefroren: Parallelbetrieb (Boss-Knoten des Kopienbaums) aktiv. */
  readonly parallel: boolean;
  readonly copies: readonly FireControlCopySnapshot[];
}

export interface FireControlPortalDeploymentSnapshot extends FireControlDeploymentSnapshotBase {
  readonly kind: 'portal';
  /** Beim Wurf eingefroren: „Lokale Feuerfreigabe“ (Boss-Knoten des Portalbaums) aktiv. */
  readonly localFireRelease: boolean;
  /** Je Tick abgeleitet: ein Eingang pro angeschlossener, kampffähiger Quelle des Besitzers. */
  readonly entries: readonly FireControlEntrySnapshot[];
}

export type FireControlDeploymentSnapshot =
  | FireControlCopiesDeploymentSnapshot
  | FireControlPortalDeploymentSnapshot;

/** World-Slice der Feuerleitung (geplanter Netzwerkschlüssel `fc`). */
export interface FireControlSnapshot {
  readonly deployments: readonly FireControlDeploymentSnapshot[];
}

export const EMPTY_FIRE_CONTROL_SNAPSHOT: FireControlSnapshot = Object.freeze({ deployments: Object.freeze([]) });

const COPY_SOURCE_ID_PREFIX = 'fc-copy:';

/**
 * Quell-ID der Kopie `slot` eines Einsatzes. Das Präfix kollidiert weder mit numerischen
 * Konstruktions-IDs noch mit Basisturm-IDs (`<baseId>:<turretId>`).
 */
export function fireControlCopySourceId(deploymentId: number, slot: number): string {
  return `${COPY_SOURCE_ID_PREFIX}${deploymentId}:${slot}`;
}

export function isFireControlCopySourceId(id: FireControlSourceId | undefined): id is string {
  return typeof id === 'string' && id.startsWith(COPY_SOURCE_ID_PREFIX);
}

/** Contribution-ID des Portal-Schadensbonus: höchstens einmal je Einsatz und Projektil. */
export function fireControlContributionId(deploymentId: number): string {
  return `fc:${deploymentId}`;
}

/** Originale, die laut Snapshot gerade pausieren (Grundversion ohne Parallelbetrieb). */
export function getPausedOriginalIds(snapshot: FireControlSnapshot): ReadonlySet<number> {
  const paused = new Set<number>();
  for (const deployment of snapshot.deployments) {
    if (deployment.kind !== 'copies') continue;
    for (const copy of deployment.copies) if (copy.originalPaused) paused.add(copy.originalId);
  }
  return paused;
}
