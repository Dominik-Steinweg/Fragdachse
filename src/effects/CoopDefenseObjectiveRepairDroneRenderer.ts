/**
 * Missionsgebundene Reparaturdrohnen eines gehaltenen Nebenziels.
 *
 * Rein lokale Präsentation auf beiden Peers: Sie entsteht aus dem replizierten Objective-Zustand
 * (`hold` + `completed` + Zeitstempel) und der ohnehin bekannten Map-Geometrie. Es gibt weder einen
 * eigenen Netzwerkkanal noch Besitzer, Kollision oder Rückwirkung auf den Spielzustand – die HP
 * kommen host-autoritativ über den Basis-Snapshot. Zeitachse und Drohnenzahl teilt der Renderer mit
 * `CoopDefenseObjectiveRepairSystem`, damit Strahl und HP-Balken zusammenfallen.
 *
 * Artwork und Arbeitseffekt werden mit dem spielergebundenen Drohnensystem geteilt;
 * unterschieden sind sie über die fehlende Besitzermarkierung und den Formationsflug statt eines Orbits
 * um einen Spieler.
 */
import { resolveActiveArenaWorldMetrics } from '../world/WorldMetrics';
import * as Phaser from 'phaser';
import {
  COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG,
  COOP_DEFENSE_OBJECTIVE_REPAIR_TOTAL_MS,
} from '../config/coopDefenseObjectiveRepair';
import { getBaseWorldBounds } from '../arena/BaseRegistry';
import type { BaseManager } from '../entities/BaseManager';
import { getSecondaryObjectiveTargets } from '../ui/coopDefenseSecondaryObjectiveModel';
import {
  createRepairDroneBody,
  updateRepairDroneRotors,
} from './repairDroneVisuals';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../types';
import { getRepairDroneWorkProbe, RepairDroneEffects } from './RepairDroneEffects';
import type { LightingSystem } from './LightingSystem';

/** Höchstens zwei gleichzeitig wiederhergestellte Ziele; die Objekte werden vorab angelegt. */
const MAX_JOBS = 2;
const MAX_DRONES = MAX_JOBS * COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG.droneCount;
/** Top-down-Stauchung der Formationsellipse, wie beim Orbit der Spielerdrohne. */
const FORMATION_Y_SQUASH = 0.72;
/** Langsame Eigendrehung der Formation, damit die Reparatur nicht statisch wirkt. */
const FORMATION_SPIN_PER_MS = 0.00035;
const ENTRY_SPREAD_RAD = 0.34;

interface DroneVisual {
  readonly body: Phaser.GameObjects.Image;
  readonly effects: RepairDroneEffects;
}

interface RepairJob {
  readonly targetId: string;
  readonly centerX: number;
  readonly centerY: number;
  /** Richtung, aus der die Drohnen kommen und in die sie wieder abfliegen. */
  readonly entryAngle: number;
  readonly formationRadius: number;
  readonly elapsedMs: number;
  readonly surfacePointOf: (fromX: number, fromY: number) => { x: number; y: number } | null;
}

export class CoopDefenseObjectiveRepairDroneRenderer {
  private readonly drones: DroneVisual[] = [];
  private built = false;
  private visible = false;
  private lighting: LightingSystem | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
    for (const drone of this.drones) drone.effects.setLightingSystem(lighting);
  }

  build(): void {
    if (this.built) return;
    this.built = true;

    for (let index = 0; index < MAX_DRONES; index += 1) {
      const body = createRepairDroneBody(this.scene, 0, 0).setVisible(false);
      const effects = new RepairDroneEffects(this.scene, `repair-drone:mission:${index}`);
      effects.setLightingSystem(this.lighting);
      this.drones.push({ body, effects });
    }
  }

  /** Pro Frame aus demselben Snapshot und derselben Rundenzeit wie HUD und Weltmarkierung. */
  sync(
    snapshot: CoopDefenseSecondaryObjectivePresentationState | null,
    configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    baseManager: BaseManager | null,
    elapsedMs: number,
    active: boolean,
  ): void {
    if (!this.built) return;
    const jobs = active && snapshot && baseManager
      ? this.collectJobs(snapshot, configs, baseManager, elapsedMs)
      : [];
    if (jobs.length === 0) {
      this.clear();
      return;
    }

    this.visible = true;
    const now = this.scene.time.now;
    const { droneCount } = COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG;

    for (let index = 0; index < this.drones.length; index += 1) {
      const job = jobs[Math.floor(index / droneCount)];
      const drone = this.drones[index];
      if (!job) {
        hideDrone(drone);
        continue;
      }
      this.applyDrone(drone, job, index % droneCount, droneCount, now);
    }
  }

  clear(): void {
    if (!this.visible) return;
    this.visible = false;
    for (const drone of this.drones) hideDrone(drone);
  }

  destroyAll(): void {
    this.clear();
  }

  destroy(): void {
    for (const drone of this.drones) {
      drone.body.destroy();
      drone.effects.destroy();
    }
    this.drones.length = 0;
    this.built = false;
    this.visible = false;
  }

  /**
   * Ein Einsatz je frisch erfülltem Hold mit Reparatur-Reward. Alles daran ist lokal ableitbar –
   * der Snapshot liefert nur Zustand und Zeitstempel.
   */
  private collectJobs(
    snapshot: CoopDefenseSecondaryObjectivePresentationState,
    configs: readonly ResolvedCoopDefenseMapSecondaryObjectiveConfig[],
    baseManager: BaseManager,
    elapsedMs: number,
  ): RepairJob[] {
    const jobs: RepairJob[] = [];
    const now = Number.isFinite(elapsedMs) ? elapsedMs : 0;
    for (const entry of snapshot) {
      if (entry.type !== 'hold' || entry.state !== 'completed') continue;
      const config = configs.find((candidate) => candidate.id === entry.objectiveId);
      if (config?.rewards?.repairTargetOnComplete !== true) continue;
      const age = now - entry.stateChangedAtMs;
      if (age < 0 || age > COOP_DEFENSE_OBJECTIVE_REPAIR_TOTAL_MS) continue;

      for (const targetId of getSecondaryObjectiveTargets(configs, entry.objectiveId)) {
        if (jobs.length >= MAX_JOBS) return jobs;
        const base = baseManager.getBase(targetId);
        if (!base || base.isDormant() || base.isDestroyed()) continue;
        const bounds = getBaseWorldBounds(base.spec.region, resolveActiveArenaWorldMetrics());
        const centerX = bounds.x + bounds.width * 0.5;
        const centerY = bounds.y + bounds.height * 0.5;
        jobs.push({
          targetId,
          centerX,
          centerY,
          entryAngle: this.getEntryAngle(baseManager, centerX, centerY),
          formationRadius: Math.max(
            COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG.formationRadiusPx,
            Math.max(bounds.width, bounds.height) * 0.62,
          ),
          elapsedMs: age,
          surfacePointOf: (fromX, fromY) => base.getNearestSurfacePoint(fromX, fromY),
        });
      }
    }
    return jobs;
  }

  /**
   * Die Drohnen kommen aus Richtung der eigenen Hauptbasis – so liest sich der Anflug als
   * Unterstützung von hinten und nicht als weiterer Angriff aus der Gegnerrichtung.
   */
  private getEntryAngle(baseManager: BaseManager, centerX: number, centerY: number): number {
    for (const base of baseManager.getBasesByFaction('friendly')) {
      if (base.role !== 'main' || base.isInert()) continue;
      const bounds = getBaseWorldBounds(base.spec.region, resolveActiveArenaWorldMetrics());
      return Math.atan2(
        bounds.y + bounds.height * 0.5 - centerY,
        bounds.x + bounds.width * 0.5 - centerX,
      );
    }
    return Math.PI;
  }

  private applyDrone(
    drone: DroneVisual,
    job: RepairJob,
    slot: number,
    droneCount: number,
    now: number,
  ): void {
    const { approachMs, repairMs, approachDistancePx } = COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG;
    const formationAngle = job.entryAngle
      + (slot / droneCount) * Math.PI * 2
      + now * FORMATION_SPIN_PER_MS;
    const stationX = job.centerX + Math.cos(formationAngle) * job.formationRadius;
    const stationY = job.centerY + Math.sin(formationAngle) * job.formationRadius * FORMATION_Y_SQUASH;

    const entryAngle = job.entryAngle + (slot - (droneCount - 1) / 2) * ENTRY_SPREAD_RAD;
    const entryX = job.centerX + Math.cos(entryAngle) * approachDistancePx;
    const entryY = job.centerY + Math.sin(entryAngle) * approachDistancePx * FORMATION_Y_SQUASH;

    let x = stationX;
    let y = stationY;
    let alpha = 1;
    let repairing = false;
    let facingX = job.centerX;
    let facingY = job.centerY;

    if (job.elapsedMs < approachMs) {
      // Anflug: schnelles Heranführen, weiches Einschwenken in die Formation.
      const progress = Phaser.Math.Easing.Sine.Out(job.elapsedMs / approachMs);
      x = Phaser.Math.Linear(entryX, stationX, progress);
      y = Phaser.Math.Linear(entryY, stationY, progress);
      alpha = Math.min(1, job.elapsedMs / (approachMs * 0.35));
      facingX = stationX;
      facingY = stationY;
    } else if (job.elapsedMs < approachMs + repairMs) {
      repairing = true;
    } else {
      const progress = Phaser.Math.Easing.Sine.In(
        (job.elapsedMs - approachMs - repairMs) / COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG.departMs,
      );
      x = Phaser.Math.Linear(stationX, entryX, progress);
      y = Phaser.Math.Linear(stationY, entryY, progress);
      alpha = 1 - progress;
      facingX = entryX;
      facingY = entryY;
    }

    const bob = Math.sin(now * 0.008 + slot * 1.7) * 2;
    drone.body
      .setVisible(true)
      .setAlpha(alpha)
      .setPosition(x, y + bob)
      .setRotation(Math.atan2(facingY - y, facingX - x) + Math.PI / 2);
    updateRepairDroneRotors(drone.body, now, slot * 37);
    const probe = getRepairDroneWorkProbe(drone.body);
    const surface = repairing ? job.surfacePointOf(probe.x, probe.y) : null;
    drone.effects.update(drone.body, surface ? { id: job.targetId, ...surface } : null, now, alpha);
  }
}

function hideDrone(drone: DroneVisual): void {
  drone.body.setVisible(false);
  drone.effects.hide();
}
