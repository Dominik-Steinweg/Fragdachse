/**
 * Missionsgebundene Reparaturdrohnen eines gehaltenen Nebenziels.
 *
 * Rein lokale Präsentation auf beiden Peers: Sie entsteht aus dem replizierten Objective-Zustand
 * (`hold` + `completed` + Zeitstempel) und der ohnehin bekannten Map-Geometrie. Es gibt weder einen
 * eigenen Netzwerkkanal noch Besitzer, Kollision oder Rückwirkung auf den Spielzustand – die HP
 * kommen host-autoritativ über den Basis-Snapshot. Zeitachse und Drohnenzahl teilt der Renderer mit
 * `CoopDefenseObjectiveRepairSystem`, damit Strahl und HP-Balken zusammenfallen.
 *
 * Optik und Strahlrezept stammen aus dem spielergebundenen Drohnensystem (`repairDroneVisuals`);
 * unterschieden sind sie über den fehlenden Besitzer-Tint und den Formationsflug statt eines Orbits
 * um einen Spieler.
 */
import * as Phaser from 'phaser';
import {
  COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG,
  COOP_DEFENSE_OBJECTIVE_REPAIR_TOTAL_MS,
} from '../config/coopDefenseObjectiveRepair';
import { getBaseWorldBounds } from '../arena/BaseRegistry';
import type { BaseManager } from '../entities/BaseManager';
import { getGraphicsQualityProfile } from '../graphics/GraphicsQuality';
import { getSecondaryObjectiveTargets } from '../ui/coopDefenseSecondaryObjectiveModel';
import {
  REPAIR_DRONE_DEPTH,
  REPAIR_DRONE_TEXTURE_KEY,
  drawRepairBeam,
  ensureRepairDroneTexture,
} from './repairDroneVisuals';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseSecondaryObjectivePresentationState } from '../types';
import { registerGraphicsObject } from './EffectUtils';

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
  readonly glow: Phaser.GameObjects.Arc;
  readonly beam: Phaser.GameObjects.Graphics;
  readonly spark: Phaser.GameObjects.Arc;
}

interface RepairJob {
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

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    ensureRepairDroneTexture(this.scene.textures);
  }

  build(): void {
    if (this.built) return;
    this.built = true;
    this.generateTextures();

    for (let index = 0; index < MAX_DRONES; index += 1) {
      const body = this.scene.add.image(0, 0, REPAIR_DRONE_TEXTURE_KEY)
        .setDepth(REPAIR_DRONE_DEPTH)
        .setVisible(false);
      const glow = this.scene.add.circle(0, 0, 13, 0x63ffc0, 0.12)
        .setStrokeStyle(1, 0xbfffe3, 0.45)
        .setDepth(REPAIR_DRONE_DEPTH - 0.02)
        .setVisible(false);
      const beam = this.scene.add.graphics()
        .setDepth(REPAIR_DRONE_DEPTH - 0.01)
        .setVisible(false);
      const spark = this.scene.add.circle(0, 0, 7, 0xc8ffe4, 0.35)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(REPAIR_DRONE_DEPTH - 0.015)
        .setVisible(false);
      registerGraphicsObject(this.scene, 'objectiveMarkers', glow);
      registerGraphicsObject(this.scene, 'objectiveMarkers', beam);
      registerGraphicsObject(this.scene, 'objectiveMarkers', spark);
      this.drones.push({ body, glow, beam, spark });
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
    const decorative = getGraphicsQualityProfile(this.scene).level !== 'low';
    const now = this.scene.time.now;
    const { droneCount } = COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG;

    for (let index = 0; index < this.drones.length; index += 1) {
      const job = jobs[Math.floor(index / droneCount)];
      const drone = this.drones[index];
      if (!job) {
        hideDrone(drone);
        continue;
      }
      this.applyDrone(drone, job, index % droneCount, droneCount, now, decorative);
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
      drone.glow.destroy();
      drone.beam.destroy();
      drone.spark.destroy();
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
        const bounds = getBaseWorldBounds(base.spec.region);
        const centerX = bounds.x + bounds.width * 0.5;
        const centerY = bounds.y + bounds.height * 0.5;
        jobs.push({
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
      const bounds = getBaseWorldBounds(base.spec.region);
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
    decorative: boolean,
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

    if (job.elapsedMs < approachMs) {
      // Anflug: schnelles Heranführen, weiches Einschwenken in die Formation.
      const progress = Phaser.Math.Easing.Sine.Out(job.elapsedMs / approachMs);
      x = Phaser.Math.Linear(entryX, stationX, progress);
      y = Phaser.Math.Linear(entryY, stationY, progress);
      alpha = Math.min(1, job.elapsedMs / (approachMs * 0.35));
    } else if (job.elapsedMs < approachMs + repairMs) {
      repairing = true;
    } else {
      const progress = Phaser.Math.Easing.Sine.In(
        (job.elapsedMs - approachMs - repairMs) / COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG.departMs,
      );
      x = Phaser.Math.Linear(stationX, entryX, progress);
      y = Phaser.Math.Linear(stationY, entryY, progress);
      alpha = 1 - progress;
    }

    const bob = Math.sin(now * 0.008 + slot * 1.7) * 2;
    drone.body
      .setVisible(true)
      .setAlpha(alpha)
      .setPosition(x, y + bob)
      .setRotation(now * 0.0012);
    drone.glow
      .setVisible(decorative)
      .setAlpha(alpha)
      .setPosition(x, y + bob)
      .setScale(0.9 + Math.sin(now * 0.01 + slot) * 0.08);

    drone.beam.clear();
    if (!repairing) {
      drone.beam.setVisible(false);
      drone.spark.setVisible(false);
      return;
    }

    const surface = job.surfacePointOf(x, y + bob);
    if (!surface) {
      drone.beam.setVisible(false);
      drone.spark.setVisible(false);
      return;
    }
    // Leichtes Flackern statt eines konstanten Strichs: Der Strahl liest sich als Arbeit, nicht als
    // statische Verbindung.
    const flicker = 0.78 + Math.sin(now * 0.021 + slot * 2.1) * 0.22;
    drone.beam.setVisible(true);
    drawRepairBeam(drone.beam, x, y + bob, surface.x, surface.y, alpha * flicker);
    drone.spark
      .setVisible(decorative)
      .setPosition(surface.x, surface.y)
      .setAlpha(alpha * 0.45 * flicker)
      .setScale(0.8 + flicker * 0.5);
  }
}

function hideDrone(drone: DroneVisual): void {
  drone.body.setVisible(false);
  drone.glow.setVisible(false);
  drone.spark.setVisible(false);
  drone.beam.clear();
  drone.beam.setVisible(false);
}
