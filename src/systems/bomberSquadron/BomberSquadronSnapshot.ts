/**
 * Replizierter Lesezustand des Bombergeschwaders (GDD Inspector Gadachs Ultimates V2 §3, Slice `bq`).
 * Der Host besitzt die Staffeln und entscheidet Anker, Abwürfe und Schaden. Der Snapshot enthält je
 * Staffel nur eingefrorene Planwerte, die gemeinsame Richtung, die festen Anker und das Stopp-Datum;
 * Flug, Abwurfpunkte, Einschlagzeiten und Explosionsoptik leitet jeder Leser deterministisch über
 * `BomberSquadronPlan` ab. Es gibt keine Nachricht je Bombe.
 *
 * Zeiten sind absolute Host-Zeiten in Millisekunden (auf Clients über
 * `NetworkBridge.getSynchronizedNow()` vergleichbar). Positionen sind Weltkoordinaten in Pixeln,
 * Winkel Radiant im Phaser-Koordinatensystem (0 = Osten, positiv im Uhrzeigersinn).
 */

/** Beim Aktivieren aus der aufgelösten Ultimate-Config eingefroren; später ändert sich nichts. */
export interface BomberSquadronPlanParams {
  readonly droneCount: number;
  readonly bombsPerPass: number;
  /** 1 oder 2 („Zweiter Anflug“). */
  readonly passCount: number;
  readonly launchIntervalMs: number;
  readonly approachMs: number;
  readonly approachDistancePx: number;
  readonly runSpeedPxPerSec: number;
  readonly corridorLeadPx: number;
  readonly corridorLengthPx: number;
  readonly corridorWidthPx: number;
  readonly turnMs: number;
  readonly departureMs: number;
  readonly bombFallMs: number;
  /** Explosionsradius; Schaden und Feuerbrocken bleiben Host-Fakten außerhalb des Snapshots. */
  readonly explosionRadius: number;
}

/** Position des Besitzers beim Anflugstart einer Drohne; legt deren Korridor fest. */
export interface BomberSquadronAnchor {
  readonly x: number;
  readonly y: number;
}

export interface BomberSquadronDeploymentSnapshot {
  /** Host-vergebene Staffel-ID, eindeutig innerhalb der World-Lifetime. */
  readonly id: number;
  readonly ownerId: string;
  readonly ownerColor: number;
  /** Aktivierungszeit; Drohne `i` startet ihren Anflug bei `startedAt + i · launchIntervalMs`. */
  readonly startedAt: number;
  /** Gemeinsame Flugrichtung aller Erstüberflüge, beim Aktivieren festgelegt. */
  readonly angle: number;
  readonly params: BomberSquadronPlanParams;
  /**
   * Anker je Drohne in Startreihenfolge (Länge `droneCount`). `null`, solange der Anflugstart
   * aussteht oder die Drohne nach dem Tod des Besitzers weggefallen ist.
   */
  readonly anchors: readonly (BomberSquadronAnchor | null)[];
  /**
   * Todeszeitpunkt des Besitzers: Drohnen, deren Anflugstart nicht vor diesem Zeitpunkt liegt,
   * starten nie. `null`, solange alle Drohnen planmäßig starten.
   */
  readonly stoppedAt: number | null;
  /**
   * Absolute Host-Zeit des letzten Bombeneinschlags nach aktuellem Stand (beim Stopp neu berechnet).
   * Bis dahin bleibt die Ultimate gesperrt; Bodenfeuer verlängert nichts.
   */
  readonly endsAt: number;
}

/** World-Slice des Bombergeschwaders (Netzwerkschlüssel `bq`); vollständig ersetzt, `[]` räumt auf. */
export interface BomberSquadronSnapshot {
  readonly squadrons: readonly BomberSquadronDeploymentSnapshot[];
}

export const EMPTY_BOMBER_SQUADRON_SNAPSHOT: BomberSquadronSnapshot = Object.freeze({ squadrons: Object.freeze([]) });

/**
 * Fire-`sourceKey` einer einzelnen Bombe. Jede Bombe besitzt einen eigenen Schlüssel, damit die
 * Brandstapel ihrer Feuerbrocken dem Angriffsdrohnenprofil entsprechen.
 */
export function bomberSquadronBombKey(squadronId: number, drone: number, pass: number, bomb: number): string {
  return `bomber:${squadronId}:${drone}:${pass}:${bomb}`;
}
