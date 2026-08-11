/**
 * Zeitachse der missionsgebundenen Reparatur eines ueberlebenden Hold-Ziels.
 *
 * Host-Heilung und Drohnen-Darstellung teilen sich diese Werte bewusst: Der Host heilt nur waehrend
 * `repairMs`, die Drohnen fliegen davor an und danach ab. Ohne gemeinsame Zeitachse wuerde der
 * HP-Balken vor oder nach dem sichtbaren Reparaturstrahl volllaufen.
 */
export const COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG = {
  /** Drohnen je Reparatureinsatz. */
  droneCount: 3,
  /** Anflug bis zur Arbeitsposition ueber dem Ziel. */
  approachMs: 1200,
  /** Eigentliche Wiederherstellung auf volle HP. */
  repairMs: 3600,
  /** Abflug samt Ausblendung. */
  departMs: 900,
  /** Abstand der Startposition vom Zielrand; die Drohnen kommen sichtbar von aussen herein. */
  approachDistancePx: 520,
  /** Radius der Arbeitsformation ueber der Basis. */
  formationRadiusPx: 46,
} as const;

/** Gesamtdauer der Praesentation; der Renderer zeigt nur innerhalb dieses Fensters Drohnen. */
export const COOP_DEFENSE_OBJECTIVE_REPAIR_TOTAL_MS = COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG.approachMs
  + COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG.repairMs
  + COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG.departMs;
